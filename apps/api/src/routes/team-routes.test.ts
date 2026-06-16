import { describe, expect, it, vi } from 'vitest'
import type { TeamRepository } from '../repositories/team-repository'
import { resolveTeamRoute } from './team-routes'

function createRepository(): TeamRepository {
  return {
    getRunsBundle: vi.fn(async () => ({ runs: [], artifacts: [], events: [] })),
    getTeamOverview: vi.fn(async () => ({
      projects: [],
      members: [],
      runs: [],
      projectCost: [],
      memberCost: [],
      totalCost: '$0.000',
    })),
    getSkills: vi.fn(async () => []),
    getMcpServers: vi.fn(async () => []),
  }
}

describe('team API route resolver', () => {
  it('routes workflow run requests through the repository', async () => {
    const repository = createRepository()
    const result = await resolveTeamRoute('GET', '/api/runs', repository)

    expect(result).toEqual({ status: 200, body: { runs: [], artifacts: [], events: [] } })
    expect(repository.getRunsBundle).toHaveBeenCalled()
  })

  it('routes manager overview requests through the repository', async () => {
    const repository = createRepository()
    const result = await resolveTeamRoute('GET', '/api/team/overview', repository)

    expect(result?.status).toBe(200)
    expect(result?.body).toMatchObject({ totalCost: '$0.000' })
    expect(repository.getTeamOverview).toHaveBeenCalled()
  })

  it('returns null for unknown paths so the server can emit 404', async () => {
    const repository = createRepository()

    await expect(resolveTeamRoute('GET', '/missing', repository)).resolves.toBeNull()
  })
})
