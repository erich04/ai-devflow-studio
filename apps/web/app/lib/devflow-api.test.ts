import { describe, expect, it, vi } from 'vitest'
import { fetchTeamOverview, resolveDevFlowApiBaseUrl, runKnowledgeReview } from './devflow-api'

describe('DevFlow web API client', () => {
  it('resolves the API base URL from server or public env', () => {
    expect(resolveDevFlowApiBaseUrl({ DEVFLOW_API_BASE_URL: 'http://api.internal:4310' })).toBe(
      'http://api.internal:4310',
    )
    expect(resolveDevFlowApiBaseUrl({ NEXT_PUBLIC_DEVFLOW_API_URL: 'http://public-api:4310' })).toBe(
      'http://public-api:4310',
    )
    expect(resolveDevFlowApiBaseUrl({})).toBe('http://127.0.0.1:4310')
  })

  it('fetches team overview from the API without importing fixtures', async () => {
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
        'x-devflow-organization-id': 'org-demo',
        'x-devflow-project-roles': 'p-payments:owner,p-admin:owner',
        'x-devflow-user-id': 'u-erich',
        'x-devflow-user-role': 'owner',
      },
      body: JSON.stringify({
        runId: 'run-1',
        nodeId: 'node-1',
        projectId: 'p-payments',
        providerId: 'fake-knowledge-review',
      }),
    })
  })
})
