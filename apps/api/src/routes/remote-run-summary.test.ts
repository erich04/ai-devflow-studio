import { describe, expect, it } from 'vitest'
import type { TeamSession } from '@ai-devflow/shared'
import { createSeedTeamRepository } from '../repositories/team-repository'
import { resolveTeamRoute } from './team-routes'

const projectMemberSession: TeamSession = {
  source: 'authenticated',
  organizationId: 'org-demo',
  userId: 'u-remote-run',
  role: 'member',
  authAccountId: 'acct-remote-run',
  projectMemberships: [
    { projectId: 'project-1', userId: 'u-remote-run', role: 'member' },
  ],
}

describe('remote Run Summary boundary', () => {
  it('sanitizes hostile title and branch-name strings before persistence', async () => {
    const repository = createSeedTeamRepository()
    const result = await resolveTeamRoute('POST', '/api/sync/run-summary', repository, {
      body: {
        kind: 'run',
        runId: 'run-hostile-metadata',
        version: 1,
        projectId: 'project-1',
        title: 'Build from /Users/Alice/private/repo API_TOKEN=title-secret',
        status: 'building',
        currentNodeId: 'node-build',
        currentNode: {
          id: 'node-build',
          stage: 'build',
          kind: 'task',
          status: 'running',
        },
        branchName: 'C:\\Users\\Alice\\private\\branch API_TOKEN=branch-secret',
        updatedAt: '2026-07-31T12:00:00.000Z',
      },
      session: projectMemberSession,
    })

    expect(result).toMatchObject({ status: 202 })
    const run = (await repository.getRunsBundle(projectMemberSession)).runs.find(
      (candidate) => candidate.id === 'run-hostile-metadata',
    )
    expect(run).toMatchObject({
      title: 'Build from [REDACTED:local_absolute_path] [REDACTED:env_secret_assignment]',
      branchName: '[REDACTED:local_absolute_path] [REDACTED:env_secret_assignment]',
    })
    expect(JSON.stringify(run)).not.toContain('title-secret')
    expect(JSON.stringify(run)).not.toContain('branch-secret')
    expect(JSON.stringify(run)).not.toContain('/Users/Alice')
    expect(JSON.stringify(run)).not.toMatch(/C:[\\/]Users[\\/]Alice/)
  })

  it('sanitizes hostile Coding Summary branch and summary strings before persistence', async () => {
    const repository = createSeedTeamRepository()
    await resolveTeamRoute('POST', '/api/sync/run-summary', repository, {
      body: {
        kind: 'run',
        runId: 'run-hostile-coding-metadata',
        version: 1,
        projectId: 'project-1',
        title: 'Coding metadata boundary',
        status: 'building',
        currentNodeId: 'node-build',
        currentNode: {
          id: 'node-build',
          stage: 'build',
          kind: 'task',
          status: 'running',
        },
        branchName: 'ai/coding-metadata-boundary',
        updatedAt: '2026-07-31T12:00:00.000Z',
      },
      session: projectMemberSession,
    })

    const result = await resolveTeamRoute(
      'POST',
      '/api/sync/coding-agent-summary',
      repository,
      {
        body: {
          id: 'coding-hostile-metadata',
          runId: 'run-hostile-coding-metadata',
          nodeId: 'node-build',
          projectId: 'project-1',
          requestedBy: projectMemberSession.userId,
          providerId: 'fake-coding-engine',
          engine: 'fake',
          status: 'completed',
          branchName: 'C:\\Users\\Alice\\private\\branch API_TOKEN=branch-secret',
          summary: 'Changed /Users/Alice/private/repo API_TOKEN=summary-secret',
          changedPaths: ['src/export.ts'],
          startedAt: '2026-07-31T12:01:00.000Z',
          completedAt: '2026-07-31T12:02:00.000Z',
          budgetDecision: {
            status: 'unavailable',
            blocksRun: true,
            currentSpendUsd: 1,
            projectedCostUsd: 2,
            reason: 'Approved from /Users/Alice/private/repo API_TOKEN=budget-secret',
          },
          redacted: true,
        },
        session: projectMemberSession,
      },
    )

    expect(result).toMatchObject({ status: 202 })
    const stored = (
      await repository.getTeamOverview(projectMemberSession)
    ).codingAgentSummaries.find(
      (summary) => summary.id === 'coding-hostile-metadata',
    )
    expect(JSON.stringify(stored)).not.toContain('branch-secret')
    expect(JSON.stringify(stored)).not.toContain('summary-secret')
    expect(JSON.stringify(stored)).not.toContain('budget-secret')
    expect(JSON.stringify(stored)).not.toContain('/Users/Alice')
    expect(JSON.stringify(stored)).not.toMatch(/C:[\\/]Users[\\/]Alice/)
  })

  it('rejects a Run Summary without an explicit positive integer version', async () => {
    const repository = createSeedTeamRepository()

    const result = await resolveTeamRoute('POST', '/api/sync/run-summary', repository, {
      body: {
        kind: 'run',
        runId: 'run-missing-version',
        projectId: 'project-1',
        title: 'Missing version must fail closed',
        status: 'building',
        currentNodeId: 'node-build',
        currentNode: {
          id: 'node-build',
          stage: 'build',
          kind: 'task',
          status: 'running',
        },
        branchName: 'ai/missing-version',
        updatedAt: '2026-07-31T12:00:00.000Z',
      },
      session: projectMemberSession,
    })

    expect(result).toEqual({
      status: 400,
      body: { error: 'bad_request', message: 'Invalid remote run summary payload' },
    })
    expect(
      (await repository.getRunsBundle(projectMemberSession)).runs.some(
        (run) => run.id === 'run-missing-version',
      ),
    ).toBe(false)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1'])(
    'rejects an invalid Run Summary version (%s)',
    async (version) => {
      const repository = createSeedTeamRepository()

      const result = await resolveTeamRoute('POST', '/api/sync/run-summary', repository, {
        body: {
          kind: 'run',
          runId: 'run-invalid-version',
          version,
          projectId: 'project-1',
          title: 'Invalid version must fail closed',
          status: 'building',
          currentNodeId: 'node-build',
          currentNode: {
            id: 'node-build',
            stage: 'build',
            kind: 'task',
            status: 'running',
          },
          branchName: 'ai/invalid-version',
          updatedAt: '2026-07-31T12:00:00.000Z',
        },
        session: projectMemberSession,
      })

      expect(result).toEqual({
        status: 400,
        body: { error: 'bad_request', message: 'Invalid remote run summary payload' },
      })
      expect(
        (await repository.getRunsBundle(projectMemberSession)).runs.some(
          (run) => run.id === 'run-invalid-version',
        ),
      ).toBe(false)
    },
  )
})
