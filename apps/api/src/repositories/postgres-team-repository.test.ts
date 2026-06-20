import { describe, expect, it } from 'vitest'
import type { TeamDbClient } from '../db/client'
import { createPostgresTeamRepository } from './postgres-team-repository'

class FakeTeamDbClient implements TeamDbClient {
  readonly queries: Array<{ sql: string; params?: unknown[] }> = []

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    this.queries.push(params === undefined ? { sql } : { sql, params })

    if (sql.includes('FROM projects')) {
      return [
        {
          id: 'p-payments',
          name: 'Payments API',
          slug: 'payments-api',
          description: 'Payment workflow service.',
          repository: 'erich/payments-api',
          default_branch: 'main',
          health: 'at_risk',
          knowledge_base_path: 'docs/payments/',
          test_command: 'pnpm test',
        },
      ] as T[]
    }

    if (sql.includes('FROM auth_accounts')) {
      return [
        {
          auth_account_id: 'acct-github-ling',
          auth_account_user_id: 'u-ling',
          provider: 'github',
          provider_account_id: 'github:ling',
          username: 'ling-gh',
          auth_account_email: 'ling@example.com',
          auth_account_created_at: '2026-06-16T09:00:00.000Z',
          auth_account_updated_at: '2026-06-16T09:05:00.000Z',
          user_id: 'u-ling',
          organization_id: 'org-demo',
          name: 'Ling',
          role: 'lead',
          email: 'ling@example.com',
          avatar_url: 'https://avatars.example/ling.png',
          avatar_initials: 'LG',
          focus: 'Architecture',
          user_created_at: '2026-06-16T08:00:00.000Z',
          user_updated_at: '2026-06-16T08:05:00.000Z',
        },
      ] as T[]
    }

    if (sql.includes('FROM project_members')) {
      return [
        { project_id: 'p-payments', user_id: 'u-ling', role: 'lead' },
        { project_id: 'p-admin', user_id: 'u-ling', role: 'member' },
      ] as T[]
    }

    if (sql.includes('FROM users')) {
      return [
        {
          id: 'u-ling',
          name: 'Ling',
          role: 'lead',
          avatar_initials: 'LG',
          focus: 'Architecture',
        },
      ] as T[]
    }

    if (sql.includes('FROM workflow_runs')) {
      return [
        {
          id: 'run-remote-1',
          title: 'Remote health endpoint',
          request: 'Add team-visible health endpoint evidence.',
          project_id: 'p-payments',
          creator_id: 'u-ling',
          status: 'paused_at_gate',
          current_node_id: 'n-design-gate',
          branch_name: 'ai/health-endpoint',
          pull_request_url: null,
          created_at: '2026-06-16T10:00:00.000Z',
          updated_at: '2026-06-16T10:15:00.000Z',
        },
      ] as T[]
    }

    if (sql.includes('FROM workflow_nodes')) {
      return [
        {
          id: 'n-design-gate',
          run_id: 'run-remote-1',
          stage: 'design',
          title: 'Architecture Gate',
          subtitle: 'Lead approval before implementation',
          kind: 'gate',
          status: 'blocked',
          owner_id: 'u-ling',
          required_role: 'lead',
          retry_count: 0,
          token_usage_id: null,
          position: 0,
        },
      ] as T[]
    }

    if (sql.includes('FROM workflow_edges')) {
      return [
        {
          id: 'edge-1',
          run_id: 'run-remote-1',
          source_node_id: 'n-design-gate',
          target_node_id: 'n-test',
          kind: 'gate',
        },
      ] as T[]
    }

    if (sql.includes('FROM artifacts')) {
      return [
        {
          id: 'art-design',
          run_id: 'run-remote-1',
          node_id: 'n-design-gate',
          kind: 'design',
          title: 'Design summary',
          summary: 'Remote design artifact summary.',
          content: 'Redacted remote artifact content.',
          redacted: true,
          updated_at: '2026-06-16T10:14:00.000Z',
        },
      ] as T[]
    }

    if (sql.includes('FROM agent_events')) {
      return [
        {
          id: 'ev-approval',
          run_id: 'run-remote-1',
          node_id: 'n-design-gate',
          sequence: 1,
          kind: 'approval',
          message: 'Waiting for lead approval.',
          timestamp: '2026-06-16T10:15:00.000Z',
        },
      ] as T[]
    }

    if (sql.includes('FROM token_usage')) {
      return [
        {
          id: 'tok-1',
          run_id: 'run-remote-1',
          node_id: 'n-design-gate',
          user_id: 'u-ling',
          project_id: 'p-payments',
          provider: 'dashscope',
          model: 'qwen3-coder-plus',
          input_tokens: 1000,
          output_tokens: 300,
          cache_read_tokens: 200,
          cost_usd: '0.109',
          timestamp: '2026-06-16T10:15:00.000Z',
        },
      ] as T[]
    }

    if (sql.includes('FROM test_evidence_summaries')) {
      return [
        {
          id: 'evidence-remote-1',
          run_id: 'run-remote-1',
          node_id: 'n-test',
          project_id: 'p-payments',
          command: 'pnpm test',
          status: 'passed',
          exit_code: 0,
          duration_ms: 1200,
          summary: 'Remote tests passed.',
          redacted: true,
          created_at: '2026-06-16T10:20:00.000Z',
        },
      ] as T[]
    }

    if (sql.includes('FROM coding_agent_summaries')) {
      return [
        {
          id: 'coding-run-remote-1',
          run_id: 'run-remote-1',
          node_id: 'n-build',
          project_id: 'p-payments',
          requested_by: 'u-ling',
          provider_id: 'fake-coding-engine',
          engine: 'fake',
          status: 'completed',
          branch_name: 'devflow/run-remote-1-n-build-coding-run-remote-1',
          summary: 'Coding summary stored in Postgres.',
          changed_paths: ['src/health.ts'],
          started_at: '2026-06-16T10:18:00.000Z',
          completed_at: '2026-06-16T10:19:00.000Z',
          redacted: true,
        },
      ] as T[]
    }

    if (sql.includes('FROM skills')) {
      return [
        {
          id: 'skill-design-review',
          name: '方案评审',
          stage: 'design',
          description: 'Review design risk.',
          version: '0.1.0',
          enabled: true,
          source: 'team',
        },
      ] as T[]
    }

    if (sql.includes('FROM mcp_server_definitions')) {
      return [
        {
          id: 'mcp-github',
          name: 'GitHub',
          command: 'mcp-server-github',
          permission: 'network',
          enabled_by_default: false,
          last_audit_event: 'Query PR checks.',
        },
      ] as T[]
    }

    return []
  }

  async close(): Promise<void> {
    return undefined
  }
}

class EmptyBootstrapDbClient implements TeamDbClient {
  readonly queries: Array<{ sql: string; params?: unknown[] }> = []

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    this.queries.push(params === undefined ? { sql } : { sql, params })

    if (sql.includes('FROM auth_accounts')) {
      return [] as T[]
    }

    if (sql.includes('FROM organizations')) {
      return [] as T[]
    }

    return [] as T[]
  }

  async close(): Promise<void> {
    return undefined
  }
}

class ExistingOrganizationNoAccountDbClient implements TeamDbClient {
  readonly queries: Array<{ sql: string; params?: unknown[] }> = []

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    this.queries.push(params === undefined ? { sql } : { sql, params })

    if (sql.includes('FROM auth_accounts')) {
      return [] as T[]
    }

    if (sql.includes('FROM organizations')) {
      return [
        {
          id: 'org-existing',
          name: 'Existing Team',
          slug: 'existing-team',
        },
      ] as T[]
    }

    return [] as T[]
  }

  async close(): Promise<void> {
    return undefined
  }
}

describe('Postgres team repository', () => {
  it('maps workflow runs with nodes, edges, artifacts, and events', async () => {
    const db = new FakeTeamDbClient()
    const repository = createPostgresTeamRepository(db)

    const bundle = await repository.getRunsBundle()

    expect(bundle.runs[0]).toMatchObject({
      id: 'run-remote-1',
      projectId: 'p-payments',
      currentNodeId: 'n-design-gate',
      nodes: [
        {
          id: 'n-design-gate',
          requiredRole: 'lead',
          artifactIds: ['art-design'],
        },
      ],
      edges: [{ id: 'edge-1', source: 'n-design-gate', target: 'n-test', kind: 'gate' }],
    })
    expect(bundle.artifacts[0]).toMatchObject({ id: 'art-design', redacted: true })
    expect(bundle.events[0]).toMatchObject({ id: 'ev-approval', kind: 'approval' })
  })

  it('builds team overview and cost rollups from Postgres rows', async () => {
    const repository = createPostgresTeamRepository(new FakeTeamDbClient())

    const overview = await repository.getTeamOverview()

    expect(overview.projects[0]).toMatchObject({
      id: 'p-payments',
      slug: 'payments-api',
      description: 'Payment workflow service.',
      defaultBranch: 'main',
      knowledgeBasePath: 'docs/payments/',
    })
    expect(overview.members[0]).toMatchObject({ id: 'u-ling', avatarInitials: 'LG' })
    expect(overview.projectCost).toEqual([
      {
        key: 'p-payments',
        inputTokens: 1000,
        outputTokens: 300,
        cacheReadTokens: 200,
        totalTokens: 1500,
        costUsd: 0.109,
      },
    ])
    expect(overview.totalCost).toBe('$0.109')
    expect(overview.testEvidenceSummaries).toEqual([
      {
        id: 'evidence-remote-1',
        runId: 'run-remote-1',
        nodeId: 'n-test',
        projectId: 'p-payments',
        command: 'pnpm test',
        status: 'passed',
        exitCode: 0,
        durationMs: 1200,
        summary: 'Remote tests passed.',
        redacted: true,
        createdAt: '2026-06-16T10:20:00.000Z',
      },
    ])
    expect(overview.codingAgentSummaries).toEqual([
      {
        id: 'coding-run-remote-1',
        runId: 'run-remote-1',
        nodeId: 'n-build',
        projectId: 'p-payments',
        requestedBy: 'u-ling',
        providerId: 'fake-coding-engine',
        engine: 'fake',
        status: 'completed',
        branchName: 'devflow/run-remote-1-n-build-coding-run-remote-1',
        summary: 'Coding summary stored in Postgres.',
        changedPaths: ['src/health.ts'],
        startedAt: '2026-06-16T10:18:00.000Z',
        completedAt: '2026-06-16T10:19:00.000Z',
        redacted: true,
      },
    ])
  })

  it('maps skills and MCP server definitions from team tables', async () => {
    const repository = createPostgresTeamRepository(new FakeTeamDbClient())

    await expect(repository.getSkills()).resolves.toEqual([
      {
        id: 'skill-design-review',
        name: '方案评审',
        stage: 'design',
        description: 'Review design risk.',
        version: '0.1.0',
        enabled: true,
        source: 'team',
      },
    ])
    await expect(repository.getMcpServers()).resolves.toEqual([
      {
        id: 'mcp-github',
        name: 'GitHub',
        command: 'mcp-server-github',
        permission: 'network',
        enabledLocally: false,
        lastAuditEvent: 'Query PR checks.',
      },
    ])
  })

  it('resolves authenticated identity from auth_accounts and existing project_members', async () => {
    const db = new FakeTeamDbClient()
    const repository = createPostgresTeamRepository(db)

    await expect(
      repository.getAuthenticatedIdentity({
        provider: 'github',
        providerAccountId: 'github:ling',
      }),
    ).resolves.toEqual({
      user: {
        id: 'u-ling',
        organizationId: 'org-demo',
        name: 'Ling',
        role: 'lead',
        email: 'ling@example.com',
        avatarUrl: 'https://avatars.example/ling.png',
        avatarInitials: 'LG',
        focus: 'Architecture',
        createdAt: '2026-06-16T08:00:00.000Z',
        updatedAt: '2026-06-16T08:05:00.000Z',
      },
      authAccount: {
        id: 'acct-github-ling',
        userId: 'u-ling',
        provider: 'github',
        providerAccountId: 'github:ling',
        username: 'ling-gh',
        email: 'ling@example.com',
        createdAt: '2026-06-16T09:00:00.000Z',
        updatedAt: '2026-06-16T09:05:00.000Z',
      },
      projectMemberships: [
        { projectId: 'p-payments', userId: 'u-ling', role: 'lead' },
        { projectId: 'p-admin', userId: 'u-ling', role: 'member' },
      ],
    })

    expect(db.queries[0]?.sql).toContain('FROM auth_accounts')
    expect(db.queries[0]?.params).toEqual(['github', 'github:ling'])
    expect(db.queries[1]?.sql).toContain('FROM project_members')
    expect(db.queries[1]?.params).toEqual(['u-ling'])
  })

  it('bootstraps the first GitHub login as the default organization owner only when the deployment is empty', async () => {
    const db = new EmptyBootstrapDbClient()
    const repository = createPostgresTeamRepository(db)

    await expect(
      repository.resolveOrBootstrapGitHubIdentity({
        providerAccountId: '123456',
        username: 'erich04',
        name: 'Erich',
        email: 'erich@example.com',
        avatarUrl: 'https://avatars.example/erich.png',
      }),
    ).resolves.toMatchObject({
      status: 'created',
      identity: {
        user: {
          id: 'u-github-123456',
          organizationId: 'org-default',
          name: 'Erich',
          role: 'owner',
          email: 'erich@example.com',
          avatarUrl: 'https://avatars.example/erich.png',
        },
        authAccount: {
          id: 'acct-github-123456',
          userId: 'u-github-123456',
          provider: 'github',
          providerAccountId: '123456',
          username: 'erich04',
          email: 'erich@example.com',
        },
        projectMemberships: [],
      },
    })

    expect(db.queries.some((query) => query.sql.includes('INSERT INTO organizations'))).toBe(true)
    expect(db.queries.some((query) => query.sql.includes('INSERT INTO users'))).toBe(true)
    expect(db.queries.some((query) => query.sql.includes('INSERT INTO auth_accounts'))).toBe(true)
  })

  it('does not silently make a later unknown GitHub login an owner when an organization already exists', async () => {
    const db = new ExistingOrganizationNoAccountDbClient()
    const repository = createPostgresTeamRepository(db)

    await expect(
      repository.resolveOrBootstrapGitHubIdentity({
        providerAccountId: '999999',
        username: 'new-person',
        name: 'New Person',
      }),
    ).resolves.toEqual({
      status: 'blocked',
      reason: 'organization_exists',
    })

    expect(db.queries.some((query) => query.sql.includes('INSERT INTO users'))).toBe(false)
    expect(db.queries.some((query) => query.sql.includes('INSERT INTO auth_accounts'))).toBe(false)
  })

  it('creates a minimal team project and records the creator as project owner', async () => {
    const db = new EmptyBootstrapDbClient()
    const repository = createPostgresTeamRepository(db)

    await expect(
      repository.createProject(
        {
          name: 'Agent Platform',
          slug: 'agent-platform',
          description: 'Pilot project for Agent platform delivery.',
          repository: 'erich/agent-platform',
        },
        { organizationId: 'org-default', userId: 'u-github-123456' },
      ),
    ).resolves.toEqual({
      id: 'p-agent-platform',
      name: 'Agent Platform',
      slug: 'agent-platform',
      description: 'Pilot project for Agent platform delivery.',
      repository: 'erich/agent-platform',
      defaultBranch: 'main',
      health: 'on_track',
      knowledgeBasePath: 'docs/agent-platform/',
      testCommand: '',
    })

    expect(db.queries.some((query) => query.sql.includes('INSERT INTO projects'))).toBe(true)
    expect(db.queries.some((query) => query.sql.includes('INSERT INTO project_members'))).toBe(true)
    expect(db.queries.at(-1)?.params).toEqual([
      'p-agent-platform',
      'u-github-123456',
      'owner',
    ])
  })

  it('writes run summaries into workflow_runs with tenant context', async () => {
    const db = new FakeTeamDbClient()
    const repository = createPostgresTeamRepository(db)

    await expect(
      repository.uploadRunSummary(
        {
          kind: 'approval',
          runId: 'run-synced',
          projectId: 'p-payments',
          title: 'Synced approval',
          status: 'building',
          currentNodeId: 'n-build',
          branchName: 'ai/synced-approval',
          updatedAt: '2026-06-16T12:00:00.000Z',
        },
        { organizationId: 'org-demo', userId: 'u-ling' },
      ),
    ).resolves.toMatchObject({
      accepted: true,
      message: 'run summary written to Postgres repository',
    })

    const write = db.queries.at(-1)
    expect(write?.sql).toContain('INSERT INTO workflow_runs')
    expect(write?.sql).toContain('ON CONFLICT (id) DO UPDATE')
    expect(write?.params).toEqual([
      'run-synced',
      'org-demo',
      'p-payments',
      'u-ling',
      'Synced approval',
      'Synced from DevFlow Electron.',
      'building',
      'run-synced:n-build',
      'ai/synced-approval',
      '2026-06-16T12:00:00.000Z',
    ])
  })

  it('writes test evidence summaries after ensuring a minimal run and test node', async () => {
    const db = new FakeTeamDbClient()
    const repository = createPostgresTeamRepository(db)

    await expect(
      repository.uploadTestEvidenceSummary(
        {
          id: 'evidence-synced',
          runId: 'run-synced',
          nodeId: 'n-test',
          projectId: 'p-payments',
          command: 'pnpm test',
          status: 'passed',
          exitCode: 0,
          durationMs: 1234,
          summary: 'Tests passed in 1.2s.',
          redacted: true,
          createdAt: '2026-06-16T12:05:00.000Z',
        },
        { organizationId: 'org-demo', userId: 'u-ling' },
      ),
    ).resolves.toMatchObject({
      accepted: true,
      message: 'test evidence summary written to Postgres repository',
    })

    const writes = db.queries.slice(-3)
    expect(writes[0]?.sql).toContain('INSERT INTO workflow_runs')
    expect(writes[0]?.params).toEqual([
      'run-synced',
      'org-demo',
      'p-payments',
      'u-ling',
      'Synced test evidence',
      'Redacted test evidence summary synced from DevFlow Electron.',
      'completed',
      'run-synced:n-test',
      'sync/run-synced',
      '2026-06-16T12:05:00.000Z',
    ])
    expect(writes[1]?.sql).toContain('INSERT INTO workflow_nodes')
    expect(writes[1]?.params).toEqual([
      'run-synced:n-test',
      'run-synced',
      'pnpm test',
      'success',
      'u-ling',
      '2026-06-16T12:05:00.000Z',
    ])
    expect(writes[2]?.sql).toContain('INSERT INTO test_evidence_summaries')
    expect(writes[2]?.params).toEqual([
      'evidence-synced',
      'run-synced',
      'run-synced:n-test',
      'p-payments',
      'pnpm test',
      'passed',
      0,
      1234,
      'Tests passed in 1.2s.',
      true,
      '2026-06-16T12:05:00.000Z',
    ])
  })

  it('writes coding agent summaries into the dedicated Postgres table', async () => {
    const db = new FakeTeamDbClient()
    const repository = createPostgresTeamRepository(db)

    await expect(
      repository.uploadCodingAgentSummary(
        {
          id: 'coding-run-synced',
          runId: 'run-synced',
          nodeId: 'n-build',
          projectId: 'p-payments',
          requestedBy: 'local-user',
          providerId: 'fake-coding-engine',
          engine: 'fake',
          status: 'completed',
          branchName: 'devflow/run-synced-n-build-coding-run-synced',
          summary: 'Coding Agent completed with redacted paths.',
          changedPaths: ['src/health.ts'],
          startedAt: '2026-06-16T12:10:00.000Z',
          completedAt: '2026-06-16T12:11:00.000Z',
          redacted: true,
        },
        { organizationId: 'org-demo', userId: 'u-ling' },
      ),
    ).resolves.toMatchObject({
      accepted: true,
      message: 'coding agent summary written to Postgres repository',
    })

    const write = db.queries.at(-1)
    expect(write?.sql).toContain('INSERT INTO coding_agent_summaries')
    expect(write?.params).toEqual([
      'coding-run-synced',
      'org-demo',
      'run-synced',
      'run-synced:n-build',
      'p-payments',
      'u-ling',
      'fake-coding-engine',
      'fake',
      'completed',
      'devflow/run-synced-n-build-coding-run-synced',
      'Coding Agent completed with redacted paths.',
      JSON.stringify(['src/health.ts']),
      '2026-06-16T12:10:00.000Z',
      '2026-06-16T12:11:00.000Z',
      true,
    ])
  })
})
