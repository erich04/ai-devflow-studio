import { describe, expect, it, vi } from 'vitest'
import type { TeamSession } from '@ai-devflow/shared'
import type { RunsBundle, TeamOverviewPayload, TeamRepository } from '../repositories/team-repository'
import { resolveTeamRoute } from './team-routes'

const ownerSession: TeamSession = {
  organizationId: 'org-demo',
  userId: 'u-erich',
  role: 'owner',
  projectMemberships: [],
}

const memberSession: TeamSession = {
  organizationId: 'org-demo',
  userId: 'u-yu',
  role: 'member',
  projectMemberships: [{ projectId: 'p-payments', userId: 'u-yu', role: 'member' }],
}

const leadSession: TeamSession = {
  organizationId: 'org-demo',
  userId: 'u-ling',
  role: 'lead',
  projectMemberships: [{ projectId: 'p-payments', userId: 'u-ling', role: 'lead' }],
}

function createRepository(): TeamRepository {
  const runsBundle: RunsBundle = {
    runs: [
      {
        id: 'run-payments',
        title: 'Payments run',
        request: 'Ship payments.',
        projectId: 'p-payments',
        creatorId: 'u-yu',
        status: 'building',
        currentNodeId: 'node-build',
        branchName: 'ai/payments',
        createdAt: '2026-06-16T00:00:00.000Z',
        updatedAt: '2026-06-16T00:01:00.000Z',
        nodes: [],
        edges: [],
      },
      {
        id: 'run-admin',
        title: 'Admin run',
        request: 'Ship admin.',
        projectId: 'p-admin',
        creatorId: 'u-erich',
        status: 'building',
        currentNodeId: 'node-build',
        branchName: 'ai/admin',
        createdAt: '2026-06-16T00:00:00.000Z',
        updatedAt: '2026-06-16T00:01:00.000Z',
        nodes: [],
        edges: [],
      },
    ],
    artifacts: [
      {
        id: 'artifact-payments',
        runId: 'run-payments',
        nodeId: 'node-build',
        kind: 'design',
        title: 'Payments design',
        summary: 'Payments only.',
        content: 'Payments private content.',
        redacted: true,
        updatedAt: '2026-06-16T00:01:00.000Z',
      },
      {
        id: 'artifact-admin',
        runId: 'run-admin',
        nodeId: 'node-build',
        kind: 'design',
        title: 'Admin design',
        summary: 'Admin only.',
        content: 'Admin private content.',
        redacted: true,
        updatedAt: '2026-06-16T00:01:00.000Z',
      },
    ],
    events: [
      {
        id: 'event-payments',
        runId: 'run-payments',
        sequence: 1,
        kind: 'sync',
        message: 'Payments sync',
        timestamp: '2026-06-16T00:01:00.000Z',
      },
      {
        id: 'event-admin',
        runId: 'run-admin',
        sequence: 1,
        kind: 'sync',
        message: 'Admin sync',
        timestamp: '2026-06-16T00:01:00.000Z',
      },
    ],
  }
  const overview: TeamOverviewPayload = {
    projects: [
      {
        id: 'p-payments',
        name: 'Payments API',
        repository: 'erich/payments-api',
        defaultBranch: 'main',
        health: 'on_track',
        knowledgeBasePath: 'docs/payments',
        testCommand: 'pnpm test',
      },
      {
        id: 'p-admin',
        name: 'Admin',
        repository: 'erich/admin',
        defaultBranch: 'main',
        health: 'at_risk',
        knowledgeBasePath: 'docs/admin',
        testCommand: 'npm test',
      },
    ],
    members: [],
    runs: runsBundle.runs,
    projectCost: [
      {
        key: 'p-payments',
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        totalTokens: 2,
        costUsd: 0.01,
      },
      {
        key: 'p-admin',
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        totalTokens: 2,
        costUsd: 0.02,
      },
    ],
    memberCost: [],
    totalCost: '$0.000',
    testEvidenceSummaries: [
      {
        id: 'evidence-payments',
        runId: 'run-payments',
        nodeId: 'node-test',
        projectId: 'p-payments',
        command: 'pnpm test',
        status: 'passed',
        exitCode: 0,
        durationMs: 900,
        summary: 'Payments tests passed',
        redacted: true,
        createdAt: '2026-06-16T00:02:00.000Z',
      },
      {
        id: 'evidence-admin',
        runId: 'run-admin',
        nodeId: 'node-test',
        projectId: 'p-admin',
        command: 'npm test',
        status: 'failed',
        exitCode: 1,
        durationMs: 1200,
        summary: 'Admin tests failed',
        redacted: true,
        createdAt: '2026-06-16T00:03:00.000Z',
      },
    ],
  }

  return {
    getRunsBundle: vi.fn(async () => runsBundle),
    getTeamOverview: vi.fn(async () => overview),
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
    const result = await resolveTeamRoute('GET', '/api/runs', repository, {
      session: ownerSession,
    })

    expect(result?.status).toBe(200)
    expect(result?.body).toMatchObject({
      runs: [{ id: 'run-payments' }, { id: 'run-admin' }],
    })
    expect(repository.getRunsBundle).toHaveBeenCalled()
  })

  it('routes manager overview requests through the repository', async () => {
    const repository = createRepository()
    const result = await resolveTeamRoute('GET', '/api/team/overview', repository, {
      session: ownerSession,
    })

    expect(result?.status).toBe(200)
    expect(result?.body).toMatchObject({ totalCost: '$0.03' })
    expect(repository.getTeamOverview).toHaveBeenCalled()
  })

  it('filters project-scoped reads for non-owner sessions', async () => {
    const repository = createRepository()

    const runsResult = await resolveTeamRoute('GET', '/api/runs', repository, {
      session: memberSession,
    })
    const overviewResult = await resolveTeamRoute('GET', '/api/team/overview', repository, {
      session: memberSession,
    })

    expect(runsResult?.body).toMatchObject({
      runs: [{ id: 'run-payments' }],
      artifacts: [{ id: 'artifact-payments' }],
      events: [{ id: 'event-payments' }],
    })
    expect(JSON.stringify(runsResult?.body)).not.toContain('run-admin')
    expect(overviewResult?.body).toMatchObject({
      projects: [{ id: 'p-payments' }],
      runs: [{ id: 'run-payments' }],
      projectCost: [{ key: 'p-payments' }],
      testEvidenceSummaries: [{ id: 'evidence-payments' }],
    })
    expect(JSON.stringify(overviewResult?.body)).not.toContain('p-admin')
    expect(JSON.stringify(overviewResult?.body)).not.toContain('evidence-admin')
  })

  it('requires an authenticated session for team routes', async () => {
    const repository = createRepository()

    await expect(resolveTeamRoute('GET', '/api/runs', repository)).resolves.toEqual({
      status: 401,
      body: { error: 'unauthorized', message: 'Authentication required' },
    })
  })

  it('routes run summary sync requests through the repository', async () => {
    const repository = createRepository()
    const summary = {
      kind: 'approval',
      runId: 'run-1',
      projectId: 'p-payments',
      title: 'Approve payment workflow',
      status: 'building',
      currentNodeId: 'node-build',
      branchName: 'ai/payments',
      updatedAt: '2026-06-16T00:00:00.000Z',
    }

    const result = await resolveTeamRoute('POST', '/api/sync/run-summary', repository, {
      body: summary,
      session: leadSession,
    })

    expect(result?.status).toBe(202)
    expect(repository.uploadRunSummary).toHaveBeenCalledWith(summary)
  })

  it('requires lead access for approval summary sync', async () => {
    const repository = createRepository()

    const result = await resolveTeamRoute('POST', '/api/sync/run-summary', repository, {
      body: {
        kind: 'approval',
        runId: 'run-1',
        projectId: 'p-payments',
        title: 'Approve payment workflow',
        status: 'building',
        currentNodeId: 'node-build',
        branchName: 'ai/payments',
        updatedAt: '2026-06-16T00:00:00.000Z',
      },
      session: memberSession,
    })

    expect(result).toEqual({
      status: 403,
      body: {
        error: 'forbidden',
        message: 'Project role lead required',
      },
    })
    expect(repository.uploadRunSummary).not.toHaveBeenCalled()
  })

  it('routes redacted test evidence sync requests through the repository', async () => {
    const repository = createRepository()
    const summary = {
      id: 'evidence-1',
      runId: 'run-1',
      nodeId: 'node-test',
      projectId: 'p-payments',
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
      { body: summary, session: memberSession },
    )

    expect(result?.status).toBe(202)
    expect(repository.uploadTestEvidenceSummary).toHaveBeenCalledWith(summary)
  })

  it('rejects local-only test evidence fields before repository sync', async () => {
    const repository = createRepository()

    const result = await resolveTeamRoute('POST', '/api/sync/test-evidence-summary', repository, {
      body: {
        id: 'evidence-1',
        runId: 'run-1',
        nodeId: 'node-test',
        projectId: 'p-payments',
        command: 'pnpm test',
        status: 'passed',
        exitCode: 0,
        durationMs: 900,
        summary: 'Tests passed in 900ms',
        redacted: true,
        createdAt: '2026-06-16T00:01:00.000Z',
        stdout: 'SECRET_TOKEN=should-not-sync',
      },
      session: memberSession,
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

    await expect(resolveTeamRoute('GET', '/missing', repository, {
      session: ownerSession,
    })).resolves.toBeNull()
  })
})
