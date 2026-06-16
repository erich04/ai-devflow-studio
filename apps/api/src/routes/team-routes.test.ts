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
    uploadRunSummary: vi.fn(async () => ({
      accepted: true,
      syncedAt: '2026-06-16T00:00:00.000Z',
      message: 'run summary accepted',
    })),
    uploadTestEvidenceSummary: vi.fn(async () => ({
      accepted: true,
      syncedAt: '2026-06-16T00:00:00.000Z',
      message: 'test evidence summary accepted',
    })),
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

  it('routes run summary sync requests through the repository', async () => {
    const repository = createRepository()
    const summary = {
      kind: 'approval',
      runId: 'run-1',
      projectId: 'project-1',
      title: 'Approve payment workflow',
      status: 'building',
      currentNodeId: 'node-build',
      branchName: 'ai/payments',
      updatedAt: '2026-06-16T00:00:00.000Z',
    }

    const result = await resolveTeamRoute('POST', '/api/sync/run-summary', repository, summary)

    expect(result?.status).toBe(202)
    expect(repository.uploadRunSummary).toHaveBeenCalledWith(summary)
  })

  it('routes redacted test evidence sync requests through the repository', async () => {
    const repository = createRepository()
    const summary = {
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
    }

    const result = await resolveTeamRoute(
      'POST',
      '/api/sync/test-evidence-summary',
      repository,
      summary,
    )

    expect(result?.status).toBe(202)
    expect(repository.uploadTestEvidenceSummary).toHaveBeenCalledWith(summary)
  })

  it('rejects local-only test evidence fields before repository sync', async () => {
    const repository = createRepository()

    const result = await resolveTeamRoute('POST', '/api/sync/test-evidence-summary', repository, {
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
      stdout: 'SECRET_TOKEN=should-not-sync',
    })

    expect(result).toEqual({
      status: 400,
      body: {
        error: 'bad_request',
        message: 'Remote test evidence summary contains local-only fields',
      },
    })
    expect(repository.uploadTestEvidenceSummary).not.toHaveBeenCalled()
  })

  it('returns null for unknown paths so the server can emit 404', async () => {
    const repository = createRepository()

    await expect(resolveTeamRoute('GET', '/missing', repository)).resolves.toBeNull()
  })
})
