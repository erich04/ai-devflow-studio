import { describe, expect, it, vi } from 'vitest'
import {
  createRecommendedEnforcementPreset,
  createWarnOnlyDefaultPolicy,
  resolveEffectivePolicy,
  type AuthenticatedIdentity,
  type GateOverrideDecision,
  type TeamSession,
} from '@ai-devflow/shared'
import type { RunsBundle, TeamOverviewPayload, TeamRepository } from '../repositories/team-repository'
import { resolveTeamRoute } from './team-routes'

const ownerSession: TeamSession = {
  source: 'authenticated',
  organizationId: 'org-demo',
  userId: 'u-erich',
  role: 'owner',
  authAccountId: 'acct-erich',
  projectMemberships: [],
}

const memberSession: TeamSession = {
  source: 'authenticated',
  organizationId: 'org-demo',
  userId: 'u-yu',
  role: 'member',
  authAccountId: 'acct-yu',
  projectMemberships: [{ projectId: 'p-payments', userId: 'u-yu', role: 'member' }],
}

const leadSession: TeamSession = {
  source: 'authenticated',
  organizationId: 'org-demo',
  userId: 'u-ling',
  role: 'lead',
  authAccountId: 'acct-ling',
  projectMemberships: [{ projectId: 'p-payments', userId: 'u-ling', role: 'lead' }],
}

const githubIdentity: AuthenticatedIdentity = {
  user: {
    id: 'u-github-123456',
    organizationId: 'org-default',
    name: 'Erich',
    role: 'owner',
    email: 'erich@example.com',
    avatarUrl: 'https://avatars.example/erich.png',
    avatarInitials: 'ER',
    focus: 'Team pilot owner',
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
  },
  authAccount: {
    id: 'acct-github-123456',
    userId: 'u-github-123456',
    provider: 'github',
    providerAccountId: '123456',
    username: 'erich04',
    email: 'erich@example.com',
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
  },
  projectMemberships: [],
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
        nodes: [
          {
            id: 'node-build',
            stage: 'design',
            title: 'Architecture Gate',
            subtitle: 'Lead approval before build.',
            kind: 'gate',
            status: 'blocked',
            ownerId: 'u-ling',
            requiredRole: 'lead',
            retryCount: 0,
            artifactIds: ['artifact-payments'],
          },
        ],
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
        slug: 'payments-api',
        description: 'Payment workflow service.',
        repository: 'erich/payments-api',
        defaultBranch: 'main',
        health: 'on_track',
        knowledgeBasePath: 'docs/payments',
        testCommand: 'pnpm test',
      },
      {
        id: 'p-admin',
        name: 'Admin',
        slug: 'admin',
        description: 'Admin workflow console.',
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
    agentReviews: [],
    agentTraces: [],
    agentTokenUsage: [],
    codingAgentSummaries: [],
    policyAwareDeliverySummaries: [],
    agentProviders: [
      {
        id: 'fake-knowledge-review',
        name: 'Deterministic Fake Provider',
        kind: 'fake',
        model: 'fake',
        enabled: true,
        updatedAt: '1970-01-01T00:00:00.000Z',
      },
    ],
    enforcementPolicies: {
      organizationPolicy: createWarnOnlyDefaultPolicy({
        organizationId: 'org-demo',
        updatedAt: '2026-06-16T00:00:00.000Z',
      }),
      projectOverrides: [],
      effectivePolicies: [
        resolveEffectivePolicy(
          createWarnOnlyDefaultPolicy({
            organizationId: 'org-demo',
            updatedAt: '2026-06-16T00:00:00.000Z',
          }),
          null,
        ),
      ],
      gateOverrides: [],
    },
  }
  const organizationPolicy = createWarnOnlyDefaultPolicy({
    organizationId: 'org-demo',
    updatedAt: '2026-06-16T00:00:00.000Z',
  })
  const gateOverrides: GateOverrideDecision[] = []

  return {
    getAuthenticatedIdentity: vi.fn(async () => null),
    resolveOrBootstrapGitHubIdentity: vi.fn(async () => ({
      status: 'blocked',
      reason: 'organization_exists',
    } as const)),
    createProject: vi.fn(async (input) => ({
      id: `p-${input.slug}`,
      name: input.name,
      slug: input.slug,
      description: input.description,
      repository: input.repository,
      defaultBranch: input.defaultBranch ?? 'main',
      health: 'on_track' as const,
      knowledgeBasePath: input.knowledgeBasePath ?? `docs/${input.slug}/`,
      testCommand: input.testCommand ?? '',
    })),
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
    uploadAgentReviewSummary: vi.fn(async () => ({
      accepted: true,
      syncedAt: '2026-06-16T00:00:00.000Z',
      message: 'agent review summary accepted',
    })),
    uploadCodingAgentSummary: vi.fn(async () => ({
      accepted: true,
      syncedAt: '2026-06-16T00:00:00.000Z',
      message: 'coding agent summary accepted',
    })),
    listAgentProviders: vi.fn(async () => overview.agentProviders),
    getEnforcementPolicy: vi.fn(async () => ({
      organizationPolicy,
      projectOverride: null,
      effectivePolicy: resolveEffectivePolicy(organizationPolicy, null),
    })),
    saveEnforcementPolicy: vi.fn(async (policy) => policy),
    saveGateOverride: vi.fn(async (decision) => {
      gateOverrides.unshift(decision)
      return decision
    }),
    listGateOverrides: vi.fn(async () => gateOverrides),
    saveAgentProviderCredential: vi.fn(async (metadata) => metadata),
    getAgentProviderCredential: vi.fn(async () => null),
    saveAgentReviewBundle: vi.fn(async (bundle) => ({
      review: bundle.review,
      trace: bundle.trace,
      tokenUsage: bundle.tokenUsage,
    })),
    listAgentReviews: vi.fn(async () => []),
  }
}

describe('team API route resolver', () => {
  it('starts GitHub OAuth by setting a state cookie and redirecting to GitHub', async () => {
    const repository = createRepository()
    const githubOAuth = {
      createAuthorizationUrl: vi.fn((input: { state: string }) =>
        `https://github.com/login/oauth/authorize?client_id=client-1&state=${input.state}`,
      ),
      exchangeCodeForProfile: vi.fn(),
    }

    const result = await resolveTeamRoute('GET', '/api/auth/github/start', repository, {
      auth: {
        sessionSecret: 'test-secret',
        createState: () => 'state-1',
      },
      githubOAuth,
    })

    expect(result).toEqual({
      status: 302,
      headers: {
        location: 'https://github.com/login/oauth/authorize?client_id=client-1&state=state-1',
        'set-cookie': 'devflow_oauth_state=state-1; HttpOnly; SameSite=Lax; Path=/; Max-Age=600',
      },
      body: { redirectTo: 'https://github.com/login/oauth/authorize?client_id=client-1&state=state-1' },
    })
  })

  it('completes GitHub OAuth callback by creating an authenticated session cookie', async () => {
    const repository = createRepository()
    vi.mocked(repository.resolveOrBootstrapGitHubIdentity).mockResolvedValueOnce({
      status: 'created',
      identity: githubIdentity,
    })
    const githubOAuth = {
      createAuthorizationUrl: vi.fn(),
      exchangeCodeForProfile: vi.fn(async () => ({
        providerAccountId: '123456',
        username: 'erich04',
        name: 'Erich',
        email: 'erich@example.com',
        avatarUrl: 'https://avatars.example/erich.png',
      })),
    }

    const result = await resolveTeamRoute('GET', '/api/auth/github/callback', repository, {
      searchParams: new URLSearchParams('code=code-1&state=state-1'),
      cookies: { devflow_oauth_state: 'state-1' },
      auth: { sessionSecret: 'test-secret' },
      githubOAuth,
    })

    expect(result?.status).toBe(302)
    expect(result?.headers?.location).toBe('/')
    expect(result?.headers?.['set-cookie']).toEqual([
      expect.stringContaining('devflow_session='),
      'devflow_oauth_state=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
    ])
    expect(repository.resolveOrBootstrapGitHubIdentity).toHaveBeenCalledWith({
      providerAccountId: '123456',
      username: 'erich04',
      name: 'Erich',
      email: 'erich@example.com',
      avatarUrl: 'https://avatars.example/erich.png',
    })
  })

  it('logs out by clearing the authenticated session cookie', async () => {
    const repository = createRepository()

    await expect(resolveTeamRoute('POST', '/api/auth/logout', repository)).resolves.toEqual({
      status: 204,
      headers: {
        'set-cookie': 'devflow_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
      },
      body: null,
    })
  })

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
  }, 15_000)

  it('allows an authenticated owner to create a minimal team project', async () => {
    const repository = createRepository()
    const result = await resolveTeamRoute('POST', '/api/team/projects', repository, {
      session: ownerSession,
      body: {
        name: 'Agent Platform',
        slug: 'agent-platform',
        description: 'Pilot project for Agent platform delivery.',
        repository: 'erich/agent-platform',
      },
    })

    expect(result).toEqual({
      status: 201,
      body: {
        id: 'p-agent-platform',
        name: 'Agent Platform',
        slug: 'agent-platform',
        description: 'Pilot project for Agent platform delivery.',
        repository: 'erich/agent-platform',
        defaultBranch: 'main',
        health: 'on_track',
        knowledgeBasePath: 'docs/agent-platform/',
        testCommand: '',
      },
    })
    expect(repository.createProject).toHaveBeenCalledWith(
      {
        name: 'Agent Platform',
        slug: 'agent-platform',
        description: 'Pilot project for Agent platform delivery.',
        repository: 'erich/agent-platform',
      },
      ownerSession,
    )
  })

  it('rejects project creation for non-owner sessions', async () => {
    const repository = createRepository()
    const result = await resolveTeamRoute('POST', '/api/team/projects', repository, {
      session: leadSession,
      body: {
        name: 'Agent Platform',
        slug: 'agent-platform',
        description: 'Pilot project for Agent platform delivery.',
        repository: 'erich/agent-platform',
      },
    })

    expect(result).toEqual({
      status: 403,
      body: {
        error: 'forbidden',
        message: 'Organization owner role required',
      },
    })
    expect(repository.createProject).not.toHaveBeenCalled()
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

  it('lists agent providers without returning provider secrets', async () => {
    const repository = createRepository()

    const result = await resolveTeamRoute('GET', '/api/agent/providers', repository, {
      session: ownerSession,
    })

    expect(result?.status).toBe(200)
    expect(result?.body).toEqual({
      providers: [expect.objectContaining({ id: 'fake-knowledge-review', kind: 'fake' })],
    })
    expect(JSON.stringify(result?.body)).not.toContain('apiKey')
    expect(JSON.stringify(result?.body)).not.toContain('encryptedSecret')
  })

  it('saves provider credentials as masked metadata for organization owners', async () => {
    const repository = createRepository()

    const result = await resolveTeamRoute('POST', '/api/agent/providers', repository, {
      session: ownerSession,
      body: {
        providerId: 'openai-default',
        apiKey: 'sk-test-provider-secret',
        model: 'gpt-4.1-mini',
        baseUrl: 'https://api.openai.com/v1',
      },
    })

    expect(result?.status).toBe(201)
    expect(result?.body).toMatchObject({
      providerId: 'openai-default',
      maskedCredential: 'sk-...cret',
    })
    expect(repository.saveAgentProviderCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai-default',
        maskedCredential: 'sk-...cret',
      }),
      expect.any(String),
      ownerSession,
    )
    expect(JSON.stringify(result?.body)).not.toContain('sk-test-provider-secret')
  })

  it('runs backend Knowledge Review with the deterministic fake provider', async () => {
    const repository = createRepository()

    const result = await resolveTeamRoute('POST', '/api/agent/knowledge-review', repository, {
      session: memberSession,
      body: {
        runId: 'run-payments',
        nodeId: 'node-build',
        projectId: 'p-payments',
        providerId: 'fake-knowledge-review',
      },
    })

    expect(result?.status).toBe(201)
    expect(result?.body).toMatchObject({
      review: {
        runId: 'run-payments',
        nodeId: 'node-build',
        runtime: 'api',
        providerId: 'fake-knowledge-review',
        gateAdvisory: {
          blocksApproval: false,
        },
      },
      artifact: {
        kind: 'agent_review',
        redacted: true,
      },
      event: {
        kind: 'agent_review',
      },
    })
    expect(repository.saveAgentReviewBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        review: expect.objectContaining({ runtime: 'api' }),
        artifact: expect.objectContaining({ kind: 'agent_review' }),
        event: expect.objectContaining({ kind: 'agent_review' }),
      }),
      memberSession,
    )
  })

  it('lists agent reviews with the runId query filter', async () => {
    const repository = createRepository()

    const result = await resolveTeamRoute('GET', '/api/agent/reviews', repository, {
      session: memberSession,
      searchParams: new URLSearchParams('runId=run-payments'),
    })

    expect(result?.status).toBe(200)
    expect(repository.listAgentReviews).toHaveBeenCalledWith({ runId: 'run-payments' }, memberSession)
  })

  it('reads the effective enforcement policy for a project', async () => {
    const repository = createRepository()

    const result = await resolveTeamRoute('GET', '/api/enforcement/policy', repository, {
      session: leadSession,
      searchParams: new URLSearchParams('projectId=p-payments'),
    })

    expect(result?.status).toBe(200)
    expect(result?.body).toMatchObject({
      organizationPolicy: { name: 'Warn-only default enforcement policy' },
      effectivePolicy: { rules: expect.any(Array) },
    })
    expect(repository.getEnforcementPolicy).toHaveBeenCalledWith('p-payments', leadSession)
  })

  it('saves organization enforcement policy for owners', async () => {
    const repository = createRepository()
    const policy = createRecommendedEnforcementPreset({
      organizationId: 'org-demo',
      updatedAt: '2026-06-16T00:00:00.000Z',
    })

    const result = await resolveTeamRoute('PUT', '/api/enforcement/policy', repository, {
      session: ownerSession,
      body: { organizationPolicy: policy },
    })

    expect(result?.status).toBe(200)
    expect(repository.saveEnforcementPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Recommended enforcement preset' }),
      ownerSession,
    )
  })

  it('evaluates enforcement decisions through the shared evaluator', async () => {
    const repository = createRepository()

    const result = await resolveTeamRoute('POST', '/api/enforcement/evaluate', repository, {
      session: leadSession,
      body: {
        runId: 'run-payments',
        nodeId: 'node-build',
        projectId: 'p-payments',
      },
    })

    expect(result?.status).toBe(200)
    expect(result?.body).toMatchObject({
      status: 'warn',
      blocksApproval: false,
    })
  })

  it('rejects gate override for owners and conflicted leads', async () => {
    const repository = createRepository()
    const body = {
      runId: 'run-payments',
      nodeId: 'node-build',
      projectId: 'p-payments',
      reason: 'I reviewed the risk.',
      blockedReasonIds: ['missing_agent_review:protected_gate:missing'],
      policyVersion: 1,
    }

    await expect(resolveTeamRoute('POST', '/api/gates/override', repository, {
      session: ownerSession,
      body,
    })).resolves.toMatchObject({ status: 403 })
    await expect(resolveTeamRoute('POST', '/api/gates/override', repository, {
      session: leadSession,
      body,
    })).resolves.toMatchObject({ status: 403 })
  })

  it('rejects approval summary sync because Gate approval must use the enforcement write path', async () => {
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

    expect(result).toEqual({
      status: 400,
      body: {
        error: 'bad_request',
        message: 'Approval summaries must be produced by the Gate approval enforcement path',
      },
    })
    expect(repository.uploadRunSummary).not.toHaveBeenCalled()
  })

  it('routes non-approval run summary sync requests through the repository', async () => {
    const repository = createRepository()
    const summary = {
      kind: 'run',
      runId: 'run-1',
      projectId: 'p-payments',
      title: 'Update payment workflow',
      status: 'building',
      currentNodeId: 'node-build',
      branchName: 'ai/payments',
      updatedAt: '2026-06-16T00:00:00.000Z',
    }

    const result = await resolveTeamRoute('POST', '/api/sync/run-summary', repository, {
      body: summary,
      session: memberSession,
    })

    expect(result?.status).toBe(202)
    expect(repository.uploadRunSummary).toHaveBeenCalledWith(summary, memberSession)
  })

  it('requires member access for non-approval run summary sync', async () => {
    const repository = createRepository()

    const result = await resolveTeamRoute('POST', '/api/sync/run-summary', repository, {
      body: {
        kind: 'run',
        runId: 'run-1',
        projectId: 'p-admin',
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
        message: 'Project role member required',
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
    expect(repository.uploadTestEvidenceSummary).toHaveBeenCalledWith(summary, memberSession)
  })

  it('routes redacted agent review summary sync requests through the repository', async () => {
    const repository = createRepository()
    const summary = {
      id: 'agent-review-1',
      runId: 'run-payments',
      nodeId: 'node-build',
      projectId: 'p-payments',
      runtime: 'electron',
      providerId: 'fake-knowledge-review',
      model: 'fake',
      conclusion: 'Knowledge review completed.',
      summary: 'Warning-only advisory generated.',
      riskCount: 1,
      missingEvidenceCount: 1,
      advisoryLevel: 'warn',
      blocksApproval: false,
      confidence: 0.82,
      redacted: true,
      createdAt: '2026-06-16T00:06:00.000Z',
    }

    const result = await resolveTeamRoute('POST', '/api/sync/agent-review-summary', repository, {
      body: summary,
      session: memberSession,
    })

    expect(result?.status).toBe(202)
    expect(repository.uploadAgentReviewSummary).toHaveBeenCalledWith(summary, memberSession)
  })

  it('rejects non-redacted agent review summary sync payloads', async () => {
    const repository = createRepository()

    const result = await resolveTeamRoute('POST', '/api/sync/agent-review-summary', repository, {
      body: {
        id: 'agent-review-1',
        runId: 'run-payments',
        nodeId: 'node-build',
        projectId: 'p-payments',
        runtime: 'electron',
        providerId: 'fake-knowledge-review',
        model: 'fake',
        conclusion: 'Knowledge review completed.',
        summary: 'Warning-only advisory generated.',
        riskCount: 1,
        missingEvidenceCount: 1,
        advisoryLevel: 'warn',
        blocksApproval: false,
        confidence: 0.82,
        redacted: false,
        createdAt: '2026-06-16T00:06:00.000Z',
      },
      session: memberSession,
    })

    expect(result).toEqual({
      status: 400,
      body: {
        error: 'bad_request',
        message: 'Invalid remote agent review summary payload',
      },
    })
    expect(repository.uploadAgentReviewSummary).not.toHaveBeenCalled()
  })

  it('routes redacted coding agent summary sync requests through the repository', async () => {
    const repository = createRepository()
    const summary = {
      id: 'coding-run-1',
      runId: 'run-payments',
      nodeId: 'node-build',
      projectId: 'p-payments',
      requestedBy: 'u-ling',
      providerId: 'fake-coding-engine',
      engine: 'fake' as const,
      status: 'completed' as const,
      branchName: 'devflow/run-payments-node-build',
      summary: 'Coding run completed with redacted diff summary.',
      changedPaths: ['src/export.ts'],
      startedAt: '2026-06-16T00:07:00.000Z',
      completedAt: '2026-06-16T00:09:00.000Z',
      redacted: true,
    }

    const result = await resolveTeamRoute('POST', '/api/sync/coding-agent-summary', repository, {
      body: summary,
      session: memberSession,
    })

    expect(result?.status).toBe(202)
    expect(repository.uploadCodingAgentSummary).toHaveBeenCalledWith(summary, memberSession)
  })

  it('rejects coding agent summaries with local-only fields or unsafe paths', async () => {
    const repository = createRepository()

    const result = await resolveTeamRoute('POST', '/api/sync/coding-agent-summary', repository, {
      body: {
        id: 'coding-run-1',
        runId: 'run-payments',
        nodeId: 'node-build',
        projectId: 'p-payments',
        requestedBy: 'u-ling',
        providerId: 'fake-coding-engine',
        engine: 'fake',
        status: 'completed',
        branchName: 'devflow/run-payments-node-build',
        summary: 'Should be rejected.',
        changedPaths: ['/Users/erich/project/src/export.ts'],
        startedAt: '2026-06-16T00:07:00.000Z',
        redacted: true,
        prompt: 'raw prompt must stay local',
      },
      session: memberSession,
    })

    expect(result).toEqual({
      status: 400,
      body: {
        error: 'bad_request',
        message: 'Remote coding agent summary contains local-only fields',
      },
    })
    expect(repository.uploadCodingAgentSummary).not.toHaveBeenCalled()
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

  it('lets repository sync failures bubble to the server error boundary', async () => {
    const repository = createRepository()
    repository.uploadRunSummary = vi.fn(async () => {
      throw new Error('database write failed')
    })

    await expect(
      resolveTeamRoute('POST', '/api/sync/run-summary', repository, {
        body: {
          kind: 'run',
          runId: 'run-1',
          projectId: 'p-payments',
          title: 'Approve payment workflow',
          status: 'building',
          currentNodeId: 'node-build',
          branchName: 'ai/payments',
          updatedAt: '2026-06-16T00:00:00.000Z',
        },
        session: memberSession,
      }),
    ).rejects.toThrow('database write failed')
  })

  it('returns null for unknown paths so the server can emit 404', async () => {
    const repository = createRepository()

    await expect(resolveTeamRoute('GET', '/missing', repository, {
      session: ownerSession,
    })).resolves.toBeNull()
  })
})
