import { describe, expect, it, vi } from 'vitest'
import {
  createDemoTeamSessionHeaders,
  createWarnOnlyDefaultPolicy,
  resolveEffectivePolicy,
} from '@ai-devflow/shared'
import {
  fetchTeamOverview,
  createDesktopPairingCode,
  createTeamProject,
  createRuntimeBudgetApproval,
  resolveDevFlowPublicApiBaseUrl,
  resolveDevFlowApiBaseUrl,
  loadRuntimeBudgetPolicy,
  runKnowledgeReview,
  saveRuntimeBudgetPolicy,
  saveEnforcementPolicy,
} from './devflow-api'

const organizationPolicy = createWarnOnlyDefaultPolicy()
const enforcementPolicies = {
  organizationPolicy,
  projectOverrides: [],
  effectivePolicies: [resolveEffectivePolicy(organizationPolicy, null)],
  gateOverrides: [],
}

describe('DevFlow web API client', () => {
  it('resolves the API base URL from server or public env', () => {
    expect(resolveDevFlowApiBaseUrl({ DEVFLOW_INTERNAL_API_BASE_URL: 'http://api:4310' })).toBe(
      'http://api:4310',
    )
    expect(resolveDevFlowApiBaseUrl({ DEVFLOW_API_BASE_URL: 'http://api.internal:4310' })).toBe(
      'http://api.internal:4310',
    )
    expect(resolveDevFlowApiBaseUrl({ NEXT_PUBLIC_DEVFLOW_API_URL: 'http://public-api:4310' })).toBe(
      'http://public-api:4310',
    )
    expect(resolveDevFlowApiBaseUrl({})).toBe('http://127.0.0.1:4310')
  })

  it('resolves the browser-facing API base URL separately from the container-internal URL', () => {
    expect(resolveDevFlowPublicApiBaseUrl({
      DEVFLOW_INTERNAL_API_BASE_URL: 'http://api:4310',
      NEXT_PUBLIC_DEVFLOW_API_URL: 'http://127.0.0.1:4310',
    })).toBe('http://127.0.0.1:4310')
    expect(resolveDevFlowPublicApiBaseUrl({ DEVFLOW_API_BASE_URL: 'http://api.internal:4310' })).toBe(
      'http://api.internal:4310',
    )
  })

  it('fetches team overview from the API without demo session headers by default', async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
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
          enforcementPolicies,
        }),
        { status: 200 },
      ),
    )

    await expect(fetchTeamOverview({ apiBaseUrl: 'http://api.local', fetcher })).resolves.toEqual({
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
      enforcementPolicies,
    })
    expect(fetcher).toHaveBeenCalledWith('http://api.local/api/team/overview', {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
      },
    })
  })

  it('uses explicit session headers only when a caller opts into them', async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
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
          enforcementPolicies,
        }),
        { status: 200 },
      ),
    )

    await fetchTeamOverview({
      apiBaseUrl: 'http://api.local',
      fetcher,
      sessionHeaders: createDemoTeamSessionHeaders(),
    })

    expect(fetcher).toHaveBeenCalledWith('http://api.local/api/team/overview', {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'x-devflow-organization-id': 'org-demo',
        'x-devflow-project-roles': 'p-payments:owner,p-admin:owner',
        'x-devflow-user-id': 'u-erich',
        'x-devflow-user-role': 'owner',
      },
    })
  })

  it('throws a clear error when the API returns a non-OK response', async () => {
    const fetcher = vi.fn(async () => new Response('nope', { status: 503 }))

    await expect(fetchTeamOverview({ apiBaseUrl: 'http://api.local', fetcher })).rejects.toThrow(
      'DevFlow API /api/team/overview failed with 503',
    )
  })

  it('runs backend Knowledge Review through the API boundary', async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          review: {
            id: 'agent-review-1',
            runtime: 'api',
          },
          trace: {
            id: 'agent-trace-1',
            steps: [],
          },
          tokenUsage: {
            id: 'agent-token-1',
          },
        }),
        { status: 201 },
      ),
    )

    await expect(
      runKnowledgeReview({
        apiBaseUrl: 'http://api.local',
        fetcher,
        runId: 'run-1',
        nodeId: 'node-1',
        projectId: 'p-payments',
      }),
    ).resolves.toMatchObject({
      review: {
        id: 'agent-review-1',
        runtime: 'api',
      },
    })
    expect(fetcher).toHaveBeenCalledWith('http://api.local/api/agent/knowledge-review', {
      method: 'POST',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        runId: 'run-1',
        nodeId: 'node-1',
        projectId: 'p-payments',
        providerId: 'fake-knowledge-review',
      }),
    })
  })

  it('saves enforcement policy through the API boundary', async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify(organizationPolicy), { status: 200 }),
    )

    await expect(
      saveEnforcementPolicy({
        apiBaseUrl: 'http://api.local',
        fetcher,
        policy: organizationPolicy,
      }),
    ).resolves.toEqual(organizationPolicy)
    expect(fetcher).toHaveBeenCalledWith('http://api.local/api/enforcement/policy', {
      method: 'PUT',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ organizationPolicy }),
    })
  })

  it('loads and saves runtime budget policy through the API boundary', async () => {
    const policy = {
      projectId: 'p-payments',
      enabled: true,
      monthlyLimitUsd: 0.25,
      warningThresholdUsd: 0.1,
      currency: 'USD' as const,
      updatedAt: '2026-06-21T00:00:00.000Z',
    }
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ policy }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(policy), { status: 200 }))

    await expect(
      loadRuntimeBudgetPolicy({
        apiBaseUrl: 'http://api.local',
        fetcher,
        projectId: 'p-payments',
        cookieHeader: 'devflow_session=session-1',
      }),
    ).resolves.toEqual(policy)
    await expect(
      saveRuntimeBudgetPolicy({
        apiBaseUrl: 'http://api.local',
        fetcher,
        projectId: 'p-payments',
        enabled: true,
        monthlyLimitUsd: 0.25,
        warningThresholdUsd: 0.1,
        cookieHeader: 'devflow_session=session-1',
      }),
    ).resolves.toEqual(policy)

    expect(fetcher).toHaveBeenNthCalledWith(1, 'http://api.local/api/runtime/budget-policy?projectId=p-payments', {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        cookie: 'devflow_session=session-1',
      },
    })
    expect(fetcher).toHaveBeenNthCalledWith(2, 'http://api.local/api/runtime/budget-policy', {
      method: 'PUT',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        cookie: 'devflow_session=session-1',
      },
      body: JSON.stringify({
        projectId: 'p-payments',
        enabled: true,
        monthlyLimitUsd: 0.25,
        warningThresholdUsd: 0.1,
      }),
    })
  })

  it('creates runtime budget approvals through the API boundary', async () => {
    const approval = {
      id: 'runtime-budget-approval-p-payments-1',
      projectId: 'p-payments',
      providerId: 'double',
      requestedBy: 'u-yu',
      approvedBy: 'u-ling',
      role: 'lead' as const,
      maxAdditionalCostUsd: 0.2,
      reason: 'Approve one real provider retry.',
      status: 'approved' as const,
      createdAt: '2026-06-21T00:00:00.000Z',
      expiresAt: '2026-06-22T00:00:00.000Z',
    }
    const fetcher = vi.fn(async () => new Response(JSON.stringify(approval), { status: 201 }))

    await expect(
      createRuntimeBudgetApproval({
        apiBaseUrl: 'http://api.local',
        fetcher,
        projectId: 'p-payments',
        providerId: 'double',
        requestedBy: 'u-yu',
        maxAdditionalCostUsd: 0.2,
        reason: 'Approve one real provider retry.',
        expiresAt: '2026-06-22T00:00:00.000Z',
        cookieHeader: 'devflow_session=session-1',
      }),
    ).resolves.toEqual(approval)
    expect(fetcher).toHaveBeenCalledWith('http://api.local/api/runtime/budget-approvals', {
      method: 'POST',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        cookie: 'devflow_session=session-1',
      },
      body: JSON.stringify({
        projectId: 'p-payments',
        providerId: 'double',
        requestedBy: 'u-yu',
        maxAdditionalCostUsd: 0.2,
        reason: 'Approve one real provider retry.',
        expiresAt: '2026-06-22T00:00:00.000Z',
      }),
    })
  })

  it('creates a minimal team project through the API boundary with forwarded cookies', async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'p-agent-platform',
          name: 'Agent Platform',
          slug: 'agent-platform',
          description: 'Pilot project.',
          repository: 'erich/agent-platform',
          defaultBranch: 'main',
          health: 'on_track',
          knowledgeBasePath: 'docs/agent-platform/',
          testCommand: '',
        }),
        { status: 201 },
      ),
    )

    await expect(
      createTeamProject({
        apiBaseUrl: 'http://api.local',
        fetcher,
        cookieHeader: 'devflow_session=session-1',
        name: 'Agent Platform',
        slug: 'agent-platform',
        description: 'Pilot project.',
        repository: 'erich/agent-platform',
      }),
    ).resolves.toMatchObject({
      id: 'p-agent-platform',
      slug: 'agent-platform',
    })
    expect(fetcher).toHaveBeenCalledWith('http://api.local/api/team/projects', {
      method: 'POST',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        cookie: 'devflow_session=session-1',
      },
      body: JSON.stringify({
        name: 'Agent Platform',
        slug: 'agent-platform',
        description: 'Pilot project.',
        repository: 'erich/agent-platform',
      }),
    })
  })

  it('creates a copy-once desktop pairing code through the API boundary', async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'pair-p-agent-platform',
          organizationId: 'org-demo',
          projectId: 'p-agent-platform',
          createdByUserId: 'u-ling',
          code: 'pair-p-agent-platform.copy-once-secret',
          expiresAt: '2026-06-20T00:10:00.000Z',
          createdAt: '2026-06-20T00:00:00.000Z',
          attemptsRemaining: 5,
        }),
        { status: 201 },
      ),
    )

    await expect(
      createDesktopPairingCode({
        apiBaseUrl: 'http://api.local',
        fetcher,
        cookieHeader: 'devflow_session=session-1',
        projectId: 'p-agent-platform',
      }),
    ).resolves.toMatchObject({
      projectId: 'p-agent-platform',
      code: 'pair-p-agent-platform.copy-once-secret',
    })
    expect(fetcher).toHaveBeenCalledWith('http://api.local/api/team/projects/p-agent-platform/pairing-codes', {
      method: 'POST',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        cookie: 'devflow_session=session-1',
      },
    })
  })
})
