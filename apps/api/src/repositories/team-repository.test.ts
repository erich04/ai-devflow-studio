import { describe, expect, it } from 'vitest'
import { createSeedTeamRepository } from './team-repository'

describe('seed team repository', () => {
  const syncContext = { organizationId: 'org-demo', userId: 'u-erich' }

  it('exposes team overview data through the repository boundary', async () => {
    const repository = createSeedTeamRepository()
    const overview = await repository.getTeamOverview()

    expect(overview.projects.length).toBeGreaterThan(0)
    expect(overview.members.length).toBeGreaterThan(0)
    expect(overview.runs.length).toBeGreaterThan(0)
    expect(overview.projectCost.length).toBeGreaterThan(0)
    expect(overview.memberCost.length).toBeGreaterThan(0)
    expect(overview.totalCost).toMatch(/^\$/)
    expect(overview.testEvidenceSummaries).toEqual([])
    expect(overview.agentReviews).toEqual([])
    expect(overview.agentTraces).toEqual([])
    expect(overview.agentTokenUsage).toEqual([])
    expect(overview.codingAgentSummaries).toEqual([])
    expect(overview.agentProviders).toEqual([
      expect.objectContaining({ id: 'fake-knowledge-review', kind: 'fake' }),
    ])
  })

  it('returns workflow runs with their artifacts and events', async () => {
    const repository = createSeedTeamRepository()
    const bundle = await repository.getRunsBundle()

    expect(bundle.runs[0]?.id).toBe('run-health-001')
    expect(bundle.artifacts.every((artifact) => artifact.runId === 'run-health-001')).toBe(true)
    expect(bundle.events.every((event) => event.runId === 'run-health-001')).toBe(true)
  })

  it('resolves demo auth accounts to an authenticated identity projection', async () => {
    const repository = createSeedTeamRepository()

    await expect(
      repository.getAuthenticatedIdentity({
        provider: 'github',
        providerAccountId: 'demo:u-ling',
      }),
    ).resolves.toMatchObject({
      user: {
        id: 'u-ling',
        organizationId: 'org-demo',
        name: 'Ling',
        role: 'lead',
      },
      authAccount: {
        id: 'acct-demo-u-ling',
        userId: 'u-ling',
        provider: 'github',
        providerAccountId: 'demo:u-ling',
        username: 'u-ling',
      },
      projectMemberships: [
        { projectId: 'p-payments', userId: 'u-ling', role: 'lead' },
        { projectId: 'p-admin', userId: 'u-ling', role: 'lead' },
      ],
    })

    await expect(
      repository.getAuthenticatedIdentity({
        provider: 'github',
        providerAccountId: 'demo:missing',
      }),
    ).resolves.toBeNull()
  })

  it('makes accepted remote sync summaries visible to team overview readers', async () => {
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
      }, syncContext),
    ).resolves.toMatchObject({ accepted: true })

    const evidenceSummary = {
      id: 'evidence-1',
      runId: 'run-1',
      nodeId: 'node-test',
      projectId: 'project-1',
      command: 'pnpm test',
      status: 'passed' as const,
      exitCode: 0,
      durationMs: 900,
      summary: 'Tests passed in 900ms',
      redacted: true,
      createdAt: '2026-06-16T00:01:00.000Z',
    }

    await expect(
      repository.uploadTestEvidenceSummary(evidenceSummary, syncContext),
    ).resolves.toMatchObject({
      accepted: true,
    })

    await expect(
      repository.uploadTestEvidenceSummary({
        ...evidenceSummary,
        summary: 'Tests passed after retry',
      }, syncContext),
    ).resolves.toMatchObject({ accepted: true })

    const codingSummary = {
      id: 'coding-run-1',
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      engine: 'fake' as const,
      status: 'completed' as const,
      branchName: 'devflow/run-1-node-build',
      summary: 'Fake coding run completed.',
      changedPaths: ['src/export.ts'],
      startedAt: '2026-06-16T00:02:00.000Z',
      completedAt: '2026-06-16T00:03:00.000Z',
      redacted: true,
    }

    await expect(repository.uploadCodingAgentSummary(codingSummary, syncContext)).resolves.toMatchObject({
      accepted: true,
    })

    const overview = await repository.getTeamOverview()
    const bundle = await repository.getRunsBundle()

    expect(overview.runs[0]).toMatchObject({
      id: 'run-1',
      title: 'Approve payment workflow',
      projectId: 'project-1',
    })
    expect(bundle.runs[0]).toMatchObject({ id: 'run-1' })
    expect(overview.testEvidenceSummaries).toEqual([
      {
        ...evidenceSummary,
        summary: 'Tests passed after retry',
      },
    ])
    expect(overview.codingAgentSummaries).toEqual([codingSummary])
  })
})
