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

  it('accepts remote sync summaries without mutating local seed data', async () => {
    const repository = createSeedTeamRepository()

    await expect(
      repository.uploadRunSummary({
        kind: 'approval',
        runId: 'run-1',
        projectId: 'project-1',
        title: 'Approve payment workflow',
        status: 'building',
        currentNodeId: 'node-build',
        branchName: 'ai/payments',
        updatedAt: '2026-06-16T00:00:00.000Z',
      }),
    ).resolves.toMatchObject({ accepted: true })

    await expect(
      repository.uploadTestEvidenceSummary({
        id: 'evidence-1',
        runId: 'run-1',
        nodeId: 'node-test',
        projectId: 'project-1',
        command: 'pnpm test',
        status: 'passed',
        exitCode: 0,
        durationMs: 900,
        summary: 'Tests passed in 900ms',
        redacted: true,
        createdAt: '2026-06-16T00:01:00.000Z',
      }),
    ).resolves.toMatchObject({ accepted: true })
  })
})
