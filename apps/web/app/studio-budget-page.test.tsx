import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Page from './page'
import { DevFlowApiError, fetchTeamOverview } from './lib/devflow-api'
import type { TeamOverviewResponse } from './lib/devflow-api'
import { createWarnOnlyDefaultPolicy } from '@ai-devflow/shared'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

vi.mock('./lib/devflow-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/devflow-api')>()
  return {
    ...actual,
    createRuntimeBudgetApproval: vi.fn(),
    createTeamProject: vi.fn(),
    fetchAuthSession: vi.fn(),
    fetchTeamOverview: vi.fn(), fetchWorkRequests: vi.fn(async () => []),
    resolveDevFlowApiBaseUrl: vi.fn(() => 'http://api.local'),
    resolveDevFlowPublicApiBaseUrl: vi.fn(() => 'http://api.local'),
    runKnowledgeReview: vi.fn(),
    saveEnforcementPolicy: vi.fn(),
    saveRuntimeBudgetPolicy: vi.fn(),
  }
})

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => undefined),
  })),
}))

const mockedFetchTeamOverview = vi.mocked(fetchTeamOverview)

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env['DEVFLOW_LOCAL_AUTH_ENABLED']
})

describe('Studio budget settings', () => {
  function budgetOverview(): TeamOverviewResponse {
    return {
      projects: ['first', 'second'].map((id) => ({
        id, name: `${id} Project`, repository: `erich/${id}`, defaultBranch: 'main',
        health: 'on_track', knowledgeBasePath: 'docs', testCommand: '',
      })),
      members: [], runs: [], projectCost: [], memberCost: [], totalCost: '$0.00',
      testEvidenceSummaries: [], codingAgentSummaries: [], agentRuntimeSummaries: [],
      agentMemorySummaries: [], agentCoordinationSummaries: [], policyAwareDeliverySummaries: [],
      agentReviews: [], agentTraces: [], agentTokenUsage: [], agentProviders: [], runtimeBudgetApprovals: [],
      runtimeBudgetPolicies: [{
        projectId: 'first', enabled: true, monthlyLimitUsd: 10, warningThresholdUsd: 5,
        currency: 'USD', updatedAt: '2026-09-06T12:00:00Z',
      }],
      enforcementPolicies: {
        organizationPolicy: createWarnOnlyDefaultPolicy({ organizationId: 'org-demo' }),
        projectOverrides: [], effectivePolicies: [], gateOverrides: [],
      },
    }
  }

  it('opens an empty budget form for the second project without borrowing the first project policy', async () => {
    mockedFetchTeamOverview.mockResolvedValue(budgetOverview())
    render(await Page({ searchParams: Promise.resolve({ view: 'settings', projectId: 'second' }) }))
    expect(screen.getByText('Budget not configured')).toBeInTheDocument()
    expect(screen.getByLabelText('Monthly limit USD')).toHaveValue(null)
    expect(screen.getByTestId('runtime-budget-policy-form').querySelector('[name="projectId"]')).toHaveValue('second')
    expect(screen.getByRole('link', { name: /second Project/ })).toHaveAttribute('aria-current', 'page')
  })

  it('remounts the selected budget form when moving between projects', async () => {
    mockedFetchTeamOverview.mockResolvedValue(budgetOverview())
    const { rerender } = render(await Page({ searchParams: Promise.resolve({ view: 'settings', projectId: 'first' }) }))
    expect(screen.getByLabelText('Monthly limit USD')).toHaveValue(10)
    rerender(await Page({ searchParams: Promise.resolve({ view: 'settings', projectId: 'second' }) }))
    expect(screen.getByLabelText('Monthly limit USD')).toHaveValue(null)
    expect(screen.getByTestId('runtime-budget-policy-form').querySelector('[name="projectId"]')).toHaveValue('second')
  })

  it('does not fall back to editing the first project when the requested project is unavailable', async () => {
    mockedFetchTeamOverview.mockResolvedValue(budgetOverview())
    render(await Page({ searchParams: Promise.resolve({ view: 'settings', projectId: 'inaccessible' }) }))
    expect(screen.getByText(/所选项目不可用/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Monthly limit USD')).not.toBeInTheDocument()
  })

})
