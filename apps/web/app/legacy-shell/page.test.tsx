import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Page from './page'
import { fetchTeamOverview } from '../lib/devflow-api'

vi.mock('../lib/devflow-api', () => ({
  createRuntimeBudgetApproval: vi.fn(),
  createTeamProject: vi.fn(),
  fetchTeamOverview: vi.fn(),
  resolveDevFlowApiBaseUrl: vi.fn(() => 'http://api.local'),
  resolveDevFlowPublicApiBaseUrl: vi.fn(() => 'http://api.local'),
  runKnowledgeReview: vi.fn(),
  saveEnforcementPolicy: vi.fn(),
  saveRuntimeBudgetPolicy: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => undefined),
  })),
}))

const mockedFetchTeamOverview = vi.mocked(fetchTeamOverview)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('legacy web shell page', () => {
  it('offers the normal GitHub sign-in route when team data is unavailable', async () => {
    mockedFetchTeamOverview.mockRejectedValue(
      new Error('DevFlow API failed with 401 internal-api.private API_TOKEN=private-value'),
    )

    render(await Page())

    expect(screen.getByText('团队数据暂时不可用')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Sign in with GitHub/ })).toHaveAttribute(
      'href',
      'http://api.local/api/auth/github/start',
    )
    expect(mockedFetchTeamOverview).toHaveBeenCalledWith({})
    expect(document.body).not.toHaveTextContent('internal-api.private')
    expect(document.body).not.toHaveTextContent('private-value')
  })
})
