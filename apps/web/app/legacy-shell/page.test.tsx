import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Page from './page'
import { DevFlowApiError, fetchTeamOverview } from '../lib/devflow-api'

vi.mock('../lib/devflow-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/devflow-api')>()
  return {
    ...actual,
    createRuntimeBudgetApproval: vi.fn(),
    createTeamProject: vi.fn(),
    fetchAuthSession: vi.fn(),
    fetchTeamOverview: vi.fn(),
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

describe('legacy web shell page', () => {
  it('offers the normal GitHub sign-in route when team data is unavailable', async () => {
    mockedFetchTeamOverview.mockRejectedValue(
      new DevFlowApiError('/api/team/overview', 401),
    )

    render(await Page())

    expect(screen.getByText('需要登录')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Sign in with GitHub/ })).toHaveAttribute(
      'href',
      'http://api.local/api/auth/github/start',
    )
    expect(mockedFetchTeamOverview).toHaveBeenCalledWith({})
  })

  it('offers local development sign-in only behind the explicit Web flag', async () => {
    process.env['DEVFLOW_LOCAL_AUTH_ENABLED'] = 'true'
    mockedFetchTeamOverview.mockRejectedValue(
      new DevFlowApiError('/api/team/overview', 401),
    )

    render(await Page())

    const button = screen.getByRole('button', { name: '使用本地开发身份' })
    const form = button.closest('form')
    expect(form).toHaveAttribute('method', 'post')
    expect(form).toHaveAttribute('action', 'http://api.local/api/auth/local/start')
    expect(form?.querySelectorAll('input')).toHaveLength(0)
  })
})
