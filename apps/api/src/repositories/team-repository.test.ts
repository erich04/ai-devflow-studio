import { describe, expect, it } from 'vitest'
import { createSeedTeamRepository } from './team-repository'

describe('seed team repository', () => {
  it('exposes team overview data through the repository boundary', async () => {
    const repository = createSeedTeamRepository()
    const overview = await repository.getTeamOverview()

    expect(overview.projects.length).toBeGreaterThan(0)
    expect(overview.members.length).toBeGreaterThan(0)
    expect(overview.runs.length).toBeGreaterThan(0)
    expect(overview.projectCost.length).toBeGreaterThan(0)
    expect(overview.memberCost.length).toBeGreaterThan(0)
    expect(overview.totalCost).toMatch(/^\$/)
  })

  it('returns workflow runs with their artifacts and events', async () => {
    const repository = createSeedTeamRepository()
    const bundle = await repository.getRunsBundle()

    expect(bundle.runs[0]?.id).toBe('run-health-001')
    expect(bundle.artifacts.every((artifact) => artifact.runId === 'run-health-001')).toBe(true)
    expect(bundle.events.every((event) => event.runId === 'run-health-001')).toBe(true)
  })
})
