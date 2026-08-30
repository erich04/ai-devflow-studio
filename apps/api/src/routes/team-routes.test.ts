import { describe, expect, it, vi } from 'vitest'
import {
  createRecommendedEnforcementPreset,
  createWarnOnlyDefaultPolicy,
  resolveEffectivePolicy,
  type AuthenticatedIdentity,
  type GateOverrideDecision,
  type TeamSession,
} from '@ai-devflow/shared'
import {
  CanonicalRunRequiredError,
  createSeedTeamRepository,
  RemoteChildSummaryConflictError,
  RemoteRunSummaryConflictError,
  type RunsBundle,
  type TeamOverviewPayload,
  type TeamRepository,
} from '../repositories/team-repository'
import { encryptAgentCredential } from '../agent-credentials'
import type { GateCommandRepository } from '../repositories/gate-command-contract'
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

function addSensitiveOverviewFixtures(
  overview: TeamOverviewPayload,
  projectId: 'p-payments' | 'p-admin',
  runId: 'run-payments' | 'run-admin',
) {
  const suffix = projectId === 'p-payments' ? 'payments' : 'admin'
  const createdAt = '2026-06-16T00:04:00.000Z'

  overview.agentReviews.push({
    id: `review-${suffix}`,
    requestId: `request-${suffix}`,
    runId,
    nodeId: 'node-build',
    projectId,
    runtime: 'api',
    providerId: 'fake-knowledge-review',
    model: 'fake',
    conclusion: 'pass',
    summary: `${suffix} private review`,
    risks: [],
    missingEvidence: [],
    suggestedTests: [],
    knowledgeReferences: [],
    policyFindings: [],
    confidence: 1,
    gateAdvisory: {
      id: `advisory-${suffix}`,
      runId,
      nodeId: 'node-build',
      level: 'info',
      blocksApproval: false,
      summary: `${suffix} private advisory`,
      missingEvidence: [],
      riskCount: 0,
      createdAt,
    },
    createdAt,
  })
  overview.agentTraces.push({
    id: `trace-${suffix}`,
    runId,
    nodeId: 'node-build',
    reviewId: `review-${suffix}`,
    runtime: 'api',
    steps: [],
    createdAt,
  })
  overview.agentTokenUsage.push({
    id: `agent-usage-${suffix}`,
    runId,
    nodeId: 'node-build',
    userId: 'u-erich',
    projectId,
    provider: 'local',
    model: 'fake',
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    costUsd: 0,
    timestamp: createdAt,
    source: 'estimated',
  })
  overview.codingAgentSummaries.push({
    id: `coding-${suffix}`,
    runId,
    nodeId: 'node-build',
    projectId,
    requestedBy: 'u-erich',
    providerId: 'fake-coding-engine',
    engine: 'fake',
    status: 'completed',
    branchName: `devflow/${runId}`,
    summary: `${suffix} private coding summary`,
    changedPaths: [],
    startedAt: createdAt,
    completedAt: createdAt,
    redacted: true,
  })
  overview.policyAwareDeliverySummaries.push({
    projectId,
    runId,
    warningCount: 0,
    blockedCount: 0,
    overrideCount: 0,
    remediationPlanCount: 0,
    retryAttemptCount: 0,
    remainingEvidenceGapCount: 0,
    redacted: true,
    updatedAt: createdAt,
  })
  overview.enforcementPolicies.gateOverrides.push({
    id: `override-${suffix}`,
    runId,
    nodeId: 'node-build',
    projectId,
    userId: 'u-ling',
    role: 'lead',
    reason: `${suffix} private override`,
    blockedReasonIds: [],
    policyVersion: 1,
    provisional: false,
    status: 'accepted',
    createdAt,
  })
  overview.runtimeBudgetPolicies.push({
    projectId,
    enabled: true,
    monthlyLimitUsd: 20,
    warningThresholdUsd: 15,
    currency: 'USD',
    updatedAt: createdAt,
  })
  overview.runtimeBudgetApprovals.push({
    id: `budget-approval-${suffix}`,
    projectId,
    requestedBy: 'u-yu',
    approvedBy: 'u-ling',
    role: 'lead',
    providerId: 'openai-default',
    maxAdditionalCostUsd: 5,
    reason: `${suffix} private budget approval`,
    status: 'approved',
    createdAt,
    expiresAt: '2026-06-17T00:04:00.000Z',
  })
}

async function withFakeRuntime<T>(callback: () => Promise<T>): Promise<T> {
  const previous = process.env['DEVFLOW_ENABLE_FAKE_RUNTIME']
  process.env['DEVFLOW_ENABLE_FAKE_RUNTIME'] = 'true'
  try {
    return await callback()
  } finally {
    if (previous === undefined) {
      delete process.env['DEVFLOW_ENABLE_FAKE_RUNTIME']
    } else {
      process.env['DEVFLOW_ENABLE_FAKE_RUNTIME'] = previous
    }
  }
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

const localDevelopmentIdentity: AuthenticatedIdentity = {
  user: {
    id: 'u-local-owner',
    organizationId: 'org-local',
    name: 'Local Developer',
    role: 'owner',
    avatarInitials: 'LD',
    focus: 'Local development owner',
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
  },
  authAccount: {
    id: 'acct-local-owner',
    userId: 'u-local-owner',
    provider: 'local-development',
    providerAccountId: 'local-owner',
    username: 'local-owner',
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
  },
  projectMemberships: [],
}

function createRepository(): TeamRepository & GateCommandRepository {
  const runsBundle: RunsBundle = {
    runs: [
      {
        id: 'run-payments',
        version: 1,
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
          {
            id: 'node-clarify',
            stage: 'clarify',
            title: 'Clarification',
            subtitle: 'Clarify the request.',
            kind: 'agent',
            status: 'success',
            ownerId: 'u-yu',
            retryCount: 0,
            artifactIds: ['artifact-payments-clarification'],
          },
          {
            id: 'node-clarify-gate',
            stage: 'clarify',
            title: 'Clarification Gate',
            subtitle: 'Approved requirements.',
            kind: 'gate',
            status: 'success',
            ownerId: 'u-yu',
            requiredRole: 'member',
            retryCount: 0,
            artifactIds: ['artifact-payments-clarification'],
          },
        ],
        edges: [
          {
            id: 'edge-payments-clarification',
            source: 'node-clarify',
            target: 'node-clarify-gate',
            kind: 'gate',
          },
        ],
      },
      {
        id: 'run-admin',
        version: 1,
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
        id: 'artifact-payments-clarification',
        runId: 'run-payments',
        nodeId: 'node-clarify',
        kind: 'clarification',
        title: 'Payments clarification',
        summary: 'Approved payments requirements.',
        content: 'Goals: ship payments. Acceptance Criteria: preserve authorization.',
        redacted: true,
        updatedAt: '2026-06-16T00:00:30.000Z',
      },
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
    agentRuntimeSummaries: [],
    agentMemorySummaries: [],
    agentCoordinationSummaries: [],
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
    runtimeBudgetPolicies: [],
    runtimeBudgetApprovals: [],
  }
  const organizationPolicy = createWarnOnlyDefaultPolicy({
    organizationId: 'org-demo',
    updatedAt: '2026-06-16T00:00:00.000Z',
  })
  const gateOverrides: GateOverrideDecision[] = []
  const runtimeBudgetPolicies = overview.runtimeBudgetPolicies
  const runtimeBudgetApprovals = overview.runtimeBudgetApprovals

  return {
    ...createSeedTeamRepository(),
    getAuthenticatedIdentity: vi.fn(async () => null),
    getAuthenticatedIdentityByAuthAccountId: vi.fn(async () => null),
    resolveBrowserSession: vi.fn(async () => null),
    resolveOrBootstrapGitHubIdentity: vi.fn(async () => ({
      status: 'blocked',
      reason: 'organization_exists',
    } as const)),
    resolveOrBootstrapLocalDevelopmentIdentity: vi.fn(async () => ({
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
    createDesktopPairingCode: vi.fn(async (input, context) => ({
      id: `pair-${input.projectId}`,
      organizationId: context.organizationId,
      projectId: input.projectId,
      createdByUserId: context.userId,
      issuedRole: (() => {
        const role = (context as TeamSession).projectMemberships.find(
          (membership) => membership.projectId === input.projectId,
        )?.role ?? 'member'
        return role === 'owner' ? 'lead' as const : role
      })(),
      code: `pair-${input.projectId}.copy-once-secret`,
      expiresAt: '2026-06-20T00:10:00.000Z',
      createdAt: '2026-06-20T00:00:00.000Z',
      attemptsRemaining: 5,
    })),
    exchangeDesktopPairingCode: vi.fn(async () => ({
      token: 'devflow-desktop-token-copy-once',
      tokenId: 'desktop-token-1',
      organizationId: 'org-demo',
      projectId: 'p-payments',
      userId: 'u-ling',
      role: 'lead' as const,
      authAccountId: 'acct-ling',
      projectMemberships: [{ projectId: 'p-payments', userId: 'u-ling', role: 'lead' as const }],
      createdAt: '2026-06-20T00:00:00.000Z',
    })),
    resolveDesktopTokenSession: vi.fn(async () => null),
    listWorkRequests: vi.fn(async () => []),
    createWorkRequest: vi.fn(async () => ({
      ok: false,
      responseStatus: 403,
      outcomeCode: 'authentication_forbidden',
      replayed: false,
    } as const)),
    claimWorkRequest: vi.fn(async () => ({
      ok: false,
      responseStatus: 403,
      outcomeCode: 'authentication_forbidden',
      replayed: false,
    } as const)),
    materializeWorkRequest: vi.fn(async () => ({
      ok: false,
      responseStatus: 403,
      outcomeCode: 'authentication_forbidden',
      replayed: false,
    } as const)),
    releaseWorkRequest: vi.fn(async () => ({
      ok: false,
      responseStatus: 403,
      outcomeCode: 'authentication_forbidden',
      replayed: false,
    } as const)),
    listGateCommands: vi.fn(async () => []),
    createGateCommand: vi.fn(async () => ({
      ok: false,
      responseStatus: 403,
      outcomeCode: 'authentication_forbidden',
      replayed: false,
    } as const)),
    listGateCommandInbox: vi.fn(async () => []),
    createGateCommandReceipt: vi.fn(async () => ({
      ok: false,
      responseStatus: 403,
      outcomeCode: 'authentication_forbidden',
      replayed: false,
    } as const)),
    acknowledgeGateCommand: vi.fn(async () => ({
      ok: false,
      responseStatus: 403,
      outcomeCode: 'authentication_forbidden',
      replayed: false,
    } as const)),
    getRunsBundle: vi.fn(async (context) =>
      context.organizationId === 'org-demo'
        ? runsBundle
        : { runs: [], artifacts: [], events: [] },
    ),
    getTeamOverview: vi.fn(async (context) =>
      context.organizationId === 'org-demo'
        ? overview
        : {
            projects: [],
            members: [],
            runs: [],
            projectCost: [],
            memberCost: [],
            totalCost: '$0.00',
            testEvidenceSummaries: [],
            agentReviews: [],
            agentTraces: [],
            agentTokenUsage: [],
            agentProviders: [],
            codingAgentSummaries: [],
            agentRuntimeSummaries: [],
            agentMemorySummaries: [],
            agentCoordinationSummaries: [],
            policyAwareDeliverySummaries: [],
            enforcementPolicies: {
              organizationPolicy: createWarnOnlyDefaultPolicy({
                organizationId: context.organizationId,
              }),
              projectOverrides: [],
              effectivePolicies: [],
              gateOverrides: [],
            },
            runtimeBudgetPolicies: [],
            runtimeBudgetApprovals: [],
          },
    ),
    getSkills: vi.fn(async () => []),
    getMcpServers: vi.fn(async () => []),
    uploadRunSummary: vi.fn(async () => ({
      accepted: true,
      syncedAt: '2026-06-16T00:00:00.000Z',
      message: 'run summary accepted',
    })),
    deleteRun: vi.fn(async () => ({
      deleted: true,
      deletedAt: '2026-06-16T00:02:00.000Z',
      message: 'run deleted',
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
    uploadAgentRuntimeSummary: vi.fn(async () => ({
      accepted: true,
      syncedAt: '2026-06-16T00:00:00.000Z',
      message: 'agent runtime summary accepted',
    })),
    uploadAgentMemorySummary: vi.fn(async () => ({
      accepted: true,
      syncedAt: '2026-06-16T00:00:00.000Z',
      message: 'agent memory summary accepted',
    })),
    uploadAgentCoordinationSummary: vi.fn(async () => ({
      accepted: true,
      syncedAt: '2026-06-16T00:00:00.000Z',
      message: 'agent coordination summary accepted',
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
    getRuntimeBudgetPolicy: vi.fn(async (projectId) =>
      runtimeBudgetPolicies.find((policy) => policy.projectId === projectId) ?? null,
    ),
    saveRuntimeBudgetPolicy: vi.fn(async (policy) => {
      const index = runtimeBudgetPolicies.findIndex((candidate) => candidate.projectId === policy.projectId)
      if (index >= 0) {
        runtimeBudgetPolicies[index] = policy
      } else {
        runtimeBudgetPolicies.unshift(policy)
      }
      return policy
    }),
    saveRuntimeBudgetApproval: vi.fn(async (approval) => {
      runtimeBudgetApprovals.unshift(approval)
      return approval
    }),
    listRuntimeBudgetApprovals: vi.fn(async (input) =>
      runtimeBudgetApprovals.filter((approval) => !input.projectId || approval.projectId === input.projectId),
    ),
    saveAgentProviderCredential: vi.fn(async (metadata) => metadata),
    getAgentProviderCredential: vi.fn(async () => null),
    saveAgentReviewBundle: vi.fn(async (bundle) => ({
      review: bundle.review,
      trace: bundle.trace,
      tokenUsage: bundle.tokenUsage,
    })),
    saveAgentEvent: vi.fn(async (event) => event),
    listAgentReviews: vi.fn(async (input) =>
      overview.agentReviews.filter((review) => !input.runId || review.runId === input.runId),
    ),
  }
}

describe('team API route resolver', () => {
  it('dispatches Gate Command routes through the authenticated Team resolver', async () => {
    const repository = createRepository()

    await expect(
      resolveTeamRoute(
        'GET',
        '/api/team/projects/p-payments/gate-commands',
        repository,
        {
          principal: {
            session: ownerSession,
            authentication: { kind: 'session_cookie', tokenRecordId: null },
          },
        },
      ),
    ).resolves.toEqual({ status: 200, body: { commands: [] } })
    expect(repository.listGateCommands).toHaveBeenCalledWith(
      'p-payments',
      expect.objectContaining({
        authentication: { kind: 'session_cookie', tokenRecordId: null },
      }),
    )
  })

  it('creates a local development browser session and redirects to the fixed legacy shell', async () => {
    const repository = createRepository()
    vi.mocked(
      repository.resolveOrBootstrapLocalDevelopmentIdentity,
    ).mockResolvedValueOnce({
      status: 'created',
      identity: localDevelopmentIdentity,
    })

    const result = await resolveTeamRoute(
      'POST',
      '/api/auth/local/start',
      repository,
      {
        auth: { sessionSecret: 'test-secret' },
        localAuth: {
          enabled: true,
          requestContentType: 'application/x-www-form-urlencoded',
          requestHost: '127.0.0.1:4310',
          requestOrigin: 'http://127.0.0.1:4311',
          webAppUrl: 'http://127.0.0.1:4311/',
        },
      },
    )

    expect(result?.status).toBe(303)
    expect(result?.headers?.location).toBe('http://127.0.0.1:4311/legacy-shell')
    expect(result?.body).toEqual({
      redirectTo: 'http://127.0.0.1:4311/legacy-shell',
    })
    const sessionCookie = String(result?.headers?.['set-cookie'])
    const encodedPayload = sessionCookie.split('=')[1]!.split('.')[0]!
    const claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
    expect(Object.keys(claims).sort()).toEqual(['authAccountId', 'expiresAt', 'v'])
    expect(claims).toMatchObject({
      v: 1,
      authAccountId: 'acct-local-owner',
    })
  })

  it('leaves the local auth route absent when the feature is disabled', async () => {
    const repository = createRepository()

    await expect(
      resolveTeamRoute('POST', '/api/auth/local/start', repository, {
        auth: { sessionSecret: 'test-secret' },
        localAuth: {
          enabled: false,
          requestContentType: 'application/x-www-form-urlencoded',
          requestHost: '127.0.0.1:4310',
          requestOrigin: 'http://127.0.0.1:4311',
          webAppUrl: 'http://127.0.0.1:4311/',
        },
      }),
    ).resolves.toBeNull()
  })

  it.each([
    ['missing Origin', undefined, '127.0.0.1:4310'],
    ['mismatched Origin', 'http://localhost:4311', '127.0.0.1:4310'],
    ['non-loopback Host', 'http://127.0.0.1:4311', 'devflow.example:4310'],
    ['mismatched Host', 'http://127.0.0.1:4311', 'localhost:4310'],
  ] as const)('rejects local sign-in with %s', async (_label, requestOrigin, requestHost) => {
    const repository = createRepository()

    const result = await resolveTeamRoute(
      'POST',
      '/api/auth/local/start',
      repository,
      {
        auth: { sessionSecret: 'test-secret' },
        localAuth: {
          enabled: true,
          requestContentType: 'application/x-www-form-urlencoded',
          requestHost,
          webAppUrl: 'http://127.0.0.1:4311/',
          ...(requestOrigin ? { requestOrigin } : {}),
        },
      },
    )

    expect(result?.status).toBe(403)
    expect(repository.resolveOrBootstrapLocalDevelopmentIdentity).not.toHaveBeenCalled()
  })

  it('rejects a non-empty local sign-in body before bootstrapping identity', async () => {
    const repository = createRepository()

    const result = await resolveTeamRoute(
      'POST',
      '/api/auth/local/start',
      repository,
      {
        auth: { sessionSecret: 'test-secret' },
        body: {},
        localAuth: {
          enabled: true,
          requestContentType: 'application/x-www-form-urlencoded',
          requestHost: '127.0.0.1:4310',
          requestOrigin: 'http://127.0.0.1:4311',
          webAppUrl: 'http://127.0.0.1:4311/',
        },
      },
    )

    expect(result?.status).toBe(400)
    expect(repository.resolveOrBootstrapLocalDevelopmentIdentity).not.toHaveBeenCalled()
  })

  it.each([undefined, 'application/json'])(
    'rejects local sign-in with non-form content type %s',
    async (requestContentType) => {
      const repository = createRepository()
      const result = await resolveTeamRoute(
        'POST',
        '/api/auth/local/start',
        repository,
        {
          auth: { sessionSecret: 'test-secret' },
          localAuth: {
            enabled: true,
            requestHost: '127.0.0.1:4310',
            requestOrigin: 'http://127.0.0.1:4311',
            webAppUrl: 'http://127.0.0.1:4311/',
            ...(requestContentType ? { requestContentType } : {}),
          },
        },
      )

      expect(result?.status).toBe(403)
      expect(repository.resolveOrBootstrapLocalDevelopmentIdentity).not.toHaveBeenCalled()
    },
  )

  it('reports an existing-organization conflict without creating a session', async () => {
    const repository = createRepository()

    const result = await resolveTeamRoute(
      'POST',
      '/api/auth/local/start',
      repository,
      {
        auth: { sessionSecret: 'test-secret' },
        localAuth: {
          enabled: true,
          requestContentType: 'application/x-www-form-urlencoded',
          requestHost: '127.0.0.1:4310',
          requestOrigin: 'http://127.0.0.1:4311',
          webAppUrl: 'http://127.0.0.1:4311/',
        },
      },
    )

    expect(result?.status).toBe(409)
    expect(result?.body).toEqual({
      error: 'organization_exists',
      message: 'Local development identity cannot bootstrap into an existing organization',
    })
    expect(result?.headers).toBeUndefined()
  })

  it('returns the provider and minimal user fields for a signed browser session', async () => {
    const repository = createRepository()
    vi.mocked(repository.getAuthenticatedIdentityByAuthAccountId).mockResolvedValueOnce(
      localDevelopmentIdentity,
    )

    const result = await resolveTeamRoute('GET', '/api/auth/session', repository, {
      principal: {
        session: {
          ...ownerSession,
          organizationId: 'org-local',
          userId: 'u-local-owner',
          authAccountId: 'acct-local-owner',
        },
        authentication: { kind: 'session_cookie', tokenRecordId: null },
      },
    })

    expect(result).toEqual({
      status: 200,
      body: {
        user: { id: 'u-local-owner', name: 'Local Developer', role: 'owner' },
        authentication: { provider: 'local-development' },
        projectMemberships: [],
      },
    })
    expect(repository.getAuthenticatedIdentityByAuthAccountId).toHaveBeenCalledWith(
      'acct-local-owner',
    )
  })

  it('requires a signed browser cookie for the auth session endpoint', async () => {
    const repository = createRepository()

    await expect(
      resolveTeamRoute('GET', '/api/auth/session', repository),
    ).resolves.toMatchObject({ status: 401 })
    await expect(
      resolveTeamRoute('GET', '/api/auth/session', repository, {
        principal: {
          session: ownerSession,
          authentication: { kind: 'development_header', tokenRecordId: null },
        },
      }),
    ).resolves.toMatchObject({ status: 403 })
  })

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
        secureCookies: true,
      },
      githubOAuth,
    })

    expect(result).toEqual({
      status: 302,
      headers: {
        location: 'https://github.com/login/oauth/authorize?client_id=client-1&state=state-1',
        'set-cookie': 'devflow_oauth_state=state-1; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600',
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
      auth: { sessionSecret: 'test-secret', secureCookies: true },
      githubOAuth,
      postAuthRedirectUrl: 'https://devflow.example/team',
    })

    expect(result?.status).toBe(302)
    expect(result?.headers?.location).toBe('https://devflow.example/team')
    expect(result?.body).toEqual({ redirectTo: 'https://devflow.example/team' })
    expect(result?.headers?.['set-cookie']).toEqual([
      expect.stringContaining('devflow_session='),
      'devflow_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
    ])
    const sessionCookie = (result?.headers?.['set-cookie'] as string[])[0]!
    const encodedPayload = sessionCookie.split('=')[1]!.split('.')[0]!
    const claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
    expect(sessionCookie).toContain('Max-Age=28800')
    expect(sessionCookie).toContain('HttpOnly; Secure; SameSite=Lax')
    expect(Object.keys(claims).sort()).toEqual(['authAccountId', 'expiresAt', 'v'])
    expect(claims).toMatchObject({ v: 1, authAccountId: 'acct-github-123456' })
    expect(claims).not.toHaveProperty('organizationId')
    expect(claims).not.toHaveProperty('role')
    expect(claims).not.toHaveProperty('projectMemberships')
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

  it('allows owners and leads to delete project runs', async () => {
    for (const session of [ownerSession, leadSession]) {
      const repository = createRepository()
      const result = await resolveTeamRoute('DELETE', '/api/runs/run-payments', repository, {
        session,
      })

      expect(result?.status).toBe(200)
      expect(result?.body).toMatchObject({ deleted: true })
      expect(repository.deleteRun).toHaveBeenCalledWith('run-payments', session)
    }
  })

  it('rejects run deletion for project members and inaccessible projects', async () => {
    const memberRepository = createRepository()
    const memberResult = await resolveTeamRoute('DELETE', '/api/runs/run-payments', memberRepository, {
      session: memberSession,
    })
    expect(memberResult).toEqual({
      status: 403,
      body: {
        error: 'forbidden',
        message: 'Project role lead required',
      },
    })
    expect(memberRepository.deleteRun).not.toHaveBeenCalled()

    const inaccessibleRepository = createRepository()
    const inaccessibleResult = await resolveTeamRoute('DELETE', '/api/runs/run-admin', inaccessibleRepository, {
      session: memberSession,
    })
    expect(inaccessibleResult).toEqual({
      status: 403,
      body: {
        error: 'forbidden',
        message: 'Project access required',
      },
    })
    expect(inaccessibleRepository.deleteRun).not.toHaveBeenCalled()
  })

  it('returns not found or conflict when a remote run cannot be deleted', async () => {
    const missingRepository = createRepository()
    await expect(resolveTeamRoute('DELETE', '/api/runs/missing-run', missingRepository, {
      session: ownerSession,
    })).resolves.toEqual({
      status: 404,
      body: {
        error: 'not_found',
        message: 'Run not found: missing-run',
      },
    })
    expect(missingRepository.deleteRun).not.toHaveBeenCalled()

    const seedRepository = createRepository()
    vi.mocked(seedRepository.deleteRun).mockResolvedValueOnce({
      deleted: false,
      deletedAt: '2026-06-16T00:02:00.000Z',
      message: 'Seed/preview runs cannot be deleted',
    })
    await expect(resolveTeamRoute('DELETE', '/api/runs/run-payments', seedRepository, {
      session: ownerSession,
    })).resolves.toEqual({
      status: 409,
      body: {
        error: 'conflict',
        message: 'Seed/preview runs cannot be deleted',
      },
    })
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

  it('normalizes overview enforcement policy to the authenticated organization', async () => {
    const repository = createRepository()
    const otherOrganizationLead: TeamSession = {
      ...leadSession,
      organizationId: 'org-real',
    }

    const result = await resolveTeamRoute('GET', '/api/team/overview', repository, {
      session: otherOrganizationLead,
    })

    expect(result?.status).toBe(200)
    expect(result?.body).toMatchObject({
      enforcementPolicies: {
        organizationPolicy: {
          organizationId: 'org-real',
          name: 'Warn-only default enforcement policy',
        },
      },
    })
    expect(JSON.stringify(result?.body)).not.toContain('enforcement-policy-org-demo-warn-only')
  })

  it('does not expose another organization projects or runs to an owner', async () => {
    const repository = createRepository()
    const otherOrganizationOwner: TeamSession = {
      ...ownerSession,
      organizationId: 'org-other',
      userId: 'u-other-owner',
      authAccountId: 'acct-other-owner',
    }

    const [runsResult, overviewResult] = await Promise.all([
      resolveTeamRoute('GET', '/api/runs', repository, { session: otherOrganizationOwner }),
      resolveTeamRoute('GET', '/api/team/overview', repository, {
        session: otherOrganizationOwner,
      }),
    ])

    expect(runsResult?.body).toEqual({ runs: [], artifacts: [], events: [] })
    expect(overviewResult?.body).toMatchObject({
      projects: [],
      runs: [],
      projectCost: [],
      totalCost: '$0.00',
    })
    expect(JSON.stringify(overviewResult?.body)).not.toContain('p-payments')
    expect(JSON.stringify(overviewResult?.body)).not.toContain('p-admin')
  })

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

  it('creates a desktop pairing code for a project lead', async () => {
    const repository = createRepository()

    const result = await resolveTeamRoute(
      'POST',
      '/api/team/projects/p-payments/pairing-codes',
      repository,
      {
        principal: {
          session: leadSession,
          authentication: { kind: 'session_cookie', tokenRecordId: null },
        },
        session: leadSession,
      },
    )

    expect(result).toEqual({
      status: 201,
      body: {
        id: 'pair-p-payments',
        organizationId: 'org-demo',
        projectId: 'p-payments',
        createdByUserId: 'u-ling',
        issuedRole: 'lead',
        code: 'pair-p-payments.copy-once-secret',
        expiresAt: '2026-06-20T00:10:00.000Z',
        createdAt: '2026-06-20T00:00:00.000Z',
        attemptsRemaining: 5,
      },
    })
    expect(repository.createDesktopPairingCode).toHaveBeenCalledWith(
      { projectId: 'p-payments' },
      leadSession,
    )
  })

  it.each([
    { label: 'member', session: memberSession, expectedIssuedRole: 'member' as const },
    {
      label: 'owner',
      session: {
        ...ownerSession,
        projectMemberships: [
          { projectId: 'p-payments', userId: ownerSession.userId, role: 'owner' as const },
        ],
      },
      expectedIssuedRole: 'lead' as const,
    },
  ])('lets an active project $label create only their own pairing code', async ({
    session,
    expectedIssuedRole,
  }) => {
    const repository = createRepository()
    const result = await resolveTeamRoute(
      'POST',
      '/api/team/projects/p-payments/pairing-codes',
      repository,
      {
        principal: {
          session,
          authentication: { kind: 'session_cookie', tokenRecordId: null },
        },
        session,
      },
    )
    expect(result).toMatchObject({
      status: 201,
      body: {
        createdByUserId: session.userId,
        issuedRole: expectedIssuedRole,
      },
    })
    expect(repository.createDesktopPairingCode).toHaveBeenCalledWith(
      { projectId: 'p-payments' },
      session,
    )
  })

  it.each([
    {
      label: 'desktop bearer',
      authentication: {
        kind: 'desktop_bearer' as const,
        tokenRecordId: 'desktop-token-1',
      },
    },
    {
      label: 'development header',
      authentication: {
        kind: 'development_header' as const,
        tokenRecordId: null,
      },
    },
  ])('does not let a $label replicate desktop credentials', async ({ authentication }) => {
    const repository = createRepository()

    const result = await resolveTeamRoute(
      'POST',
      '/api/team/projects/p-payments/pairing-codes',
      repository,
      {
        principal: { session: leadSession, authentication },
        session: leadSession,
      },
    )

    expect(result).toEqual({
      status: 403,
      body: {
        error: 'forbidden',
        message: 'Signed browser session required',
      },
    })
    expect(repository.createDesktopPairingCode).not.toHaveBeenCalled()
  })

  it('lets a signed member explicitly revoke only a scoped pairing code', async () => {
    const repository = createRepository()
    const revoke = vi.spyOn(repository, 'revokeDesktopPairingCode').mockResolvedValueOnce(true)
    const result = await resolveTeamRoute(
      'DELETE',
      '/api/team/projects/p-payments/pairing-codes/pair-p-payments',
      repository,
      {
        principal: {
          session: memberSession,
          authentication: { kind: 'session_cookie', tokenRecordId: null },
        },
        session: memberSession,
      },
    )
    expect(result).toEqual({ status: 200, body: { revoked: true } })
    expect(revoke).toHaveBeenCalledWith(
      { projectId: 'p-payments', pairingCodeId: 'pair-p-payments' },
      memberSession,
    )
  })

  it('lets a Desktop bearer revoke only its own token record', async () => {
    const repository = createRepository()
    const revoke = vi.spyOn(repository, 'revokeDesktopToken').mockResolvedValueOnce(true)
    const principal = {
      session: memberSession,
      authentication: { kind: 'desktop_bearer' as const, tokenRecordId: 'desktop-token-1' },
    }
    await expect(
      resolveTeamRoute(
        'DELETE',
        '/api/team/projects/p-payments/desktop-tokens/desktop-token-other',
        repository,
        { principal, session: memberSession },
      ),
    ).resolves.toMatchObject({ status: 403 })
    expect(revoke).not.toHaveBeenCalled()

    await expect(
      resolveTeamRoute(
        'DELETE',
        '/api/team/projects/p-payments/desktop-tokens/desktop-token-1',
        repository,
        { principal, session: memberSession },
      ),
    ).resolves.toEqual({ status: 200, body: { revoked: true } })
    expect(revoke).toHaveBeenCalledWith(
      { projectId: 'p-payments', tokenId: 'desktop-token-1' },
      memberSession,
    )
  })

  it('rejects desktop pairing code creation without active access to the project', async () => {
    const repository = createRepository()

    const result = await resolveTeamRoute(
      'POST',
      '/api/team/projects/p-admin/pairing-codes',
      repository,
      {
        principal: {
          session: memberSession,
          authentication: { kind: 'session_cookie', tokenRecordId: null },
        },
        session: memberSession,
      },
    )

    expect(result).toEqual({
      status: 403,
      body: {
        error: 'forbidden',
        message: 'Active project membership required',
      },
    })
    expect(repository.createDesktopPairingCode).not.toHaveBeenCalled()
  })

  it('does not let an organization owner pair a project from another organization', async () => {
    const repository = createRepository()
    const otherOrganizationOwner: TeamSession = {
      ...ownerSession,
      organizationId: 'org-other',
      userId: 'u-other-owner',
      authAccountId: 'acct-other-owner',
      projectMemberships: [],
    }

    const result = await resolveTeamRoute(
      'POST',
      '/api/team/projects/p-payments/pairing-codes',
      repository,
      {
        principal: {
          session: otherOrganizationOwner,
          authentication: { kind: 'session_cookie', tokenRecordId: null },
        },
        session: otherOrganizationOwner,
      },
    )

    expect(result).toEqual({
      status: 404,
      body: { error: 'not_found', message: 'Project not found' },
    })
    expect(repository.createDesktopPairingCode).not.toHaveBeenCalled()
  })

  it('exchanges a desktop pairing code for a copy-once bearer token', async () => {
    const repository = createRepository()

    const result = await resolveTeamRoute('POST', '/api/desktop/pairing/exchange', repository, {
      body: { code: 'pair-p-payments.copy-once-secret' },
    })

    expect(result).toEqual({
      status: 201,
      body: {
        token: 'devflow-desktop-token-copy-once',
        tokenId: 'desktop-token-1',
        organizationId: 'org-demo',
        projectId: 'p-payments',
        userId: 'u-ling',
        role: 'lead',
        authAccountId: 'acct-ling',
        projectMemberships: [{ projectId: 'p-payments', userId: 'u-ling', role: 'lead' }],
        createdAt: '2026-06-20T00:00:00.000Z',
      },
    })
    expect(repository.exchangeDesktopPairingCode).toHaveBeenCalledWith({
      code: 'pair-p-payments.copy-once-secret',
    })
  })

  it('rejects client-supplied identity or role during pairing exchange', async () => {
    const repository = createRepository()
    const result = await resolveTeamRoute('POST', '/api/desktop/pairing/exchange', repository, {
      body: {
        code: 'pair-p-payments.copy-once-secret',
        userId: 'u-attacker',
        role: 'owner',
      },
    })
    expect(result).toMatchObject({ status: 400 })
    expect(repository.exchangeDesktopPairingCode).not.toHaveBeenCalled()
  })

  it('rejects invalid desktop pairing codes with a reconnect-safe message', async () => {
    const repository = createRepository()
    vi.mocked(repository.exchangeDesktopPairingCode).mockRejectedValueOnce(
      new Error('invalid desktop pairing code'),
    )

    const result = await resolveTeamRoute('POST', '/api/desktop/pairing/exchange', repository, {
      body: { code: 'pair-p-payments.wrong-secret' },
    })

    expect(result).toEqual({
      status: 401,
      body: {
        error: 'unauthorized',
        message: 'Desktop pairing code is invalid or expired. Reconnect DevFlow Studio.',
      },
    })
  })

  it('rejects expired desktop pairing codes with the same reconnect-safe message', async () => {
    const repository = createRepository()
    vi.mocked(repository.exchangeDesktopPairingCode).mockRejectedValueOnce(
      new Error('expired desktop pairing code'),
    )

    const result = await resolveTeamRoute('POST', '/api/desktop/pairing/exchange', repository, {
      body: { code: 'pair-p-payments.copy-once-secret' },
    })

    expect(result).toEqual({
      status: 401,
      body: {
        error: 'unauthorized',
        message: 'Desktop pairing code is invalid or expired. Reconnect DevFlow Studio.',
      },
    })
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
      artifacts: expect.arrayContaining([
        expect.objectContaining({ id: 'artifact-payments' }),
        expect.objectContaining({ id: 'artifact-payments-clarification' }),
      ]),
      events: [{ id: 'event-payments' }],
    })
    expect(JSON.stringify(runsResult?.body)).not.toContain('run-admin')
    expect(overviewResult?.body).toMatchObject({
      projects: [{ id: 'p-payments' }],
      runs: [{ id: 'run-payments' }],
      projectCost: [{ key: 'p-payments' }],
      testEvidenceSummaries: [{ id: 'evidence-payments' }],
      enforcementPolicies: {
        effectivePolicies: [{ projectId: 'p-payments' }],
      },
    })
    expect(JSON.stringify(overviewResult?.body)).not.toContain('p-admin')
    expect(JSON.stringify(overviewResult?.body)).not.toContain('evidence-admin')
  })

  it('filters every project- or run-scoped overview collection for project members', async () => {
    const repository = createRepository()
    const storedOverview = await repository.getTeamOverview(ownerSession)
    addSensitiveOverviewFixtures(storedOverview, 'p-payments', 'run-payments')
    addSensitiveOverviewFixtures(storedOverview, 'p-admin', 'run-admin')

    const result = await resolveTeamRoute('GET', '/api/team/overview', repository, {
      session: memberSession,
    })

    expect(result?.status).toBe(200)
    const overview = result?.body as TeamOverviewPayload
    expect(overview.agentReviews.map((review) => review.id)).toEqual(['review-payments'])
    expect(overview.agentTraces.map((trace) => trace.id)).toEqual(['trace-payments'])
    expect(overview.agentTokenUsage.map((usage) => usage.id)).toEqual(['agent-usage-payments'])
    expect(overview.codingAgentSummaries.map((summary) => summary.id)).toEqual(['coding-payments'])
    expect(overview.policyAwareDeliverySummaries.map((summary) => summary.projectId)).toEqual([
      'p-payments',
    ])
    expect(overview.enforcementPolicies.gateOverrides.map((override) => override.id)).toEqual([
      'override-payments',
    ])
    expect(overview.runtimeBudgetPolicies.map((policy) => policy.projectId)).toEqual([
      'p-payments',
    ])
    expect(overview.runtimeBudgetApprovals.map((approval) => approval.id)).toEqual([
      'budget-approval-payments',
    ])
    expect(JSON.stringify(overview)).not.toContain('private admin')
    expect(JSON.stringify(overview)).not.toContain('review-admin')
    expect(JSON.stringify(overview)).not.toContain('run-admin')
    expect(JSON.stringify(overview)).not.toContain('p-admin')
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
      name: 'OpenAI Compatible',
      maskedCredential: 'sk-...cret',
    })
    expect(repository.saveAgentProviderCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai-default',
        name: 'OpenAI Compatible',
        maskedCredential: 'sk-...cret',
      }),
      expect.any(String),
      ownerSession,
    )
    expect(JSON.stringify(result?.body)).not.toContain('sk-test-provider-secret')
  })

  it('generates the provider identity from a user-facing Provider Name', async () => {
    const repository = createRepository()

    const result = await resolveTeamRoute('POST', '/api/agent/providers', repository, {
      session: ownerSession,
      body: {
        name: '公司火山方舟',
        apiKey: 'sk-generated-provider-secret',
        model: 'ark-code-latest',
      },
    })

    expect(result?.status).toBe(201)
    expect(result?.body).toMatchObject({
      providerId: expect.stringMatching(/^provider_[a-f0-9]{32}$/),
      name: '公司火山方舟',
      model: 'ark-code-latest',
    })
    expect(repository.saveAgentProviderCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: expect.stringMatching(/^provider_[a-f0-9]{32}$/),
        name: '公司火山方舟',
      }),
      expect.any(String),
      ownerSession,
    )
    expect(JSON.stringify(result)).not.toContain('sk-generated-provider-secret')
  })

  it('rejects empty and duplicate Provider Names without persisting a credential', async () => {
    const repository = createRepository()
    vi.mocked(repository.listAgentProviders).mockResolvedValue([
      {
        id: 'provider_existing',
        name: 'OpenAI Production',
        kind: 'openai-compatible',
        model: 'gpt-4.1-mini',
        enabled: true,
        updatedAt: '2026-08-30T00:00:00.000Z',
      },
    ])

    const empty = await resolveTeamRoute('POST', '/api/agent/providers', repository, {
      session: ownerSession,
      body: { name: ' ', apiKey: 'sk-secret', model: 'gpt-4.1-mini' },
    })
    const duplicate = await resolveTeamRoute('POST', '/api/agent/providers', repository, {
      session: ownerSession,
      body: { name: ' openai   production ', apiKey: 'sk-secret', model: 'gpt-4.1-mini' },
    })

    expect(empty).toMatchObject({ status: 400, body: { message: 'Provider name is required.' } })
    expect(duplicate).toMatchObject({
      status: 409,
      body: { message: 'Provider name already exists.' },
    })
    expect(repository.saveAgentProviderCredential).not.toHaveBeenCalled()
  })

  it('runs backend Knowledge Review with the deterministic fake provider', async () => {
    const repository = createRepository()

    const result = await withFakeRuntime(() =>
      resolveTeamRoute('POST', '/api/agent/knowledge-review', repository, {
        session: memberSession,
        body: {
          runId: 'run-payments',
          nodeId: 'node-build',
          projectId: 'p-payments',
          providerId: 'fake-knowledge-review',
        },
      }),
    )

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
    expect(repository.getRuntimeBudgetPolicy).not.toHaveBeenCalled()
    expect(repository.listRuntimeBudgetApprovals).not.toHaveBeenCalled()
    expect(repository.getAgentProviderCredential).not.toHaveBeenCalled()
    expect(repository.saveAgentEvent).not.toHaveBeenCalled()
  })

  it('blocks a paid Knowledge Review with a redacted audit before resolving credentials when the budget policy is missing', async () => {
    const repository = createRepository()
    const overview = await repository.getTeamOverview(ownerSession)
    overview.agentProviders.push({
      id: 'openai-default',
      name: 'OpenAI Compatible',
      kind: 'openai-compatible',
      model: 'gpt-4.1-mini',
      enabled: true,
      maskedCredential: 'sk-...cret',
      updatedAt: '2026-06-16T00:00:00.000Z',
    })
    const providerFetch = vi.fn()
    const originalFetch = globalThis.fetch
    globalThis.fetch = providerFetch as typeof fetch

    try {
      const result = await resolveTeamRoute('POST', '/api/agent/knowledge-review', repository, {
        session: memberSession,
        body: {
          runId: 'run-payments',
          nodeId: 'node-build',
          projectId: 'p-payments',
          providerId: 'openai-default',
        },
      })

      expect(result).toMatchObject({
        status: 409,
        body: {
          status: 'blocked',
          budgetDecision: {
            status: 'unavailable',
            blocksRun: true,
            reason: 'Runtime budget policy is unavailable for this project.',
          },
          audit: {
            runId: 'run-payments',
            nodeId: 'node-build',
            kind: 'error',
            message: expect.stringContaining(
              'projectId=p-payments providerId=openai-default requestedBy=u-yu approvalId=none status=unavailable',
            ),
          },
        },
      })
      expect(repository.getRuntimeBudgetPolicy).toHaveBeenCalledWith('p-payments', memberSession)
      expect(repository.getAgentProviderCredential).not.toHaveBeenCalled()
      expect(providerFetch).not.toHaveBeenCalled()
      expect(repository.saveAgentReviewBundle).not.toHaveBeenCalled()
      expect(repository.saveAgentEvent).toHaveBeenCalledOnce()
      expect(JSON.stringify(result)).not.toContain('sk-...cret')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('runs a paid Knowledge Review once with an exact scoped runtime budget approval', async () => {
    const repository = createRepository()
    const overview = await repository.getTeamOverview(ownerSession)
    overview.agentProviders.push({
      id: 'openai-default',
      name: 'OpenAI Compatible',
      kind: 'openai-compatible',
      model: 'gpt-4.1-mini',
      enabled: true,
      maskedCredential: 'sk-...cret',
      updatedAt: '2026-06-16T00:00:00.000Z',
    })
    await repository.saveRuntimeBudgetPolicy(
      {
        projectId: 'p-payments',
        enabled: true,
        monthlyLimitUsd: 0,
        warningThresholdUsd: 0,
        currency: 'USD',
        updatedAt: '2026-07-31T00:00:00.000Z',
      },
      memberSession,
    )
    await repository.saveRuntimeBudgetApproval(
      {
        id: 'knowledge-review-approval-1',
        projectId: 'p-payments',
        requestedBy: memberSession.userId,
        approvedBy: leadSession.userId,
        role: 'lead',
        providerId: 'openai-default',
        maxAdditionalCostUsd: 1,
        reason: 'Approved for this review only.',
        status: 'approved',
        createdAt: '2026-07-31T00:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
      leadSession,
    )
    vi.mocked(repository.getAgentProviderCredential).mockResolvedValue({
      metadata: {
        providerId: 'openai-default',
        model: 'gpt-4.1-mini',
        baseUrl: 'https://provider.example/v1',
        maskedCredential: 'sk-...cret',
        updatedAt: '2026-06-16T00:00:00.000Z',
      },
      encryptedSecret: encryptAgentCredential('sk-test-provider-secret'),
    })
    const providerFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  conclusion: 'ready',
                  summary: 'Scoped paid review completed.',
                  risks: [],
                  missingEvidence: [],
                  suggestedTests: [],
                  confidence: 0.9,
                }),
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }),
        { status: 200 },
      ),
    )
    const originalFetch = globalThis.fetch
    globalThis.fetch = providerFetch as typeof fetch

    try {
      const result = await resolveTeamRoute('POST', '/api/agent/knowledge-review', repository, {
        session: memberSession,
        body: {
          runId: 'run-payments',
          nodeId: 'node-build',
          projectId: 'p-payments',
          providerId: 'openai-default',
          runtimeBudgetApprovalId: 'knowledge-review-approval-1',
        },
      })

      expect(result).toMatchObject({
        status: 201,
        body: {
          review: {
            providerId: 'openai-default',
            summary: 'Scoped paid review completed.',
          },
          budgetDecision: {
            status: 'approved_over_budget',
            blocksRun: false,
            approvalId: 'knowledge-review-approval-1',
          },
        },
      })
      expect(providerFetch).toHaveBeenCalledOnce()
      const providerRequest = JSON.parse(
        String(providerFetch.mock.calls[0]?.[1]?.body),
      ) as { messages: Array<{ role: string; content: string }> }
      const providerPrompt = providerRequest.messages.find((message) => message.role === 'user')?.content ?? ''
      expect(providerPrompt).toContain('Ship payments.')
      expect(providerPrompt).toContain('Goals: ship payments. Acceptance Criteria: preserve authorization.')
      expect(providerPrompt).toContain('Payments private content.')
      expect(providerPrompt).toContain('"REVIEW_SUBJECT"')
      expect(providerPrompt).toContain('"REVIEW_CRITERIA"')
      expect(providerPrompt).toContain('"CONTEXT_APPLICABILITY"')
      expect(providerPrompt).toContain('"supplementalTestEvidence"')
      expect(repository.getAgentProviderCredential).toHaveBeenCalledOnce()
      expect(repository.saveAgentReviewBundle).toHaveBeenCalledOnce()
      const savedManifest = vi.mocked(repository.saveAgentReviewBundle).mock.calls[0]?.[0].review.contextManifest
      expect(savedManifest).toMatchObject({ stage: 'design', coverage: 'complete' })
      expect(savedManifest?.fieldProjection?.fields).toEqual(expect.arrayContaining([
        expect.objectContaining({
          field: 'test_evidence',
          state: 'available',
          role: 'supplemental',
          includeInProviderPrompt: true,
        }),
      ]))
      expect(repository.saveAgentEvent).not.toHaveBeenCalled()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('blocks a paid Knowledge Review before credentials when the selected approval has the wrong provider scope', async () => {
    const repository = createRepository()
    const overview = await repository.getTeamOverview(ownerSession)
    overview.agentProviders.push({
      id: 'openai-default',
      name: 'OpenAI Compatible',
      kind: 'openai-compatible',
      model: 'gpt-4.1-mini',
      enabled: true,
      maskedCredential: 'sk-...cret',
      updatedAt: '2026-06-16T00:00:00.000Z',
    })
    await repository.saveRuntimeBudgetPolicy(
      {
        projectId: 'p-payments',
        enabled: true,
        monthlyLimitUsd: 0,
        warningThresholdUsd: 0,
        currency: 'USD',
        updatedAt: '2026-07-31T00:00:00.000Z',
      },
      memberSession,
    )
    await repository.saveRuntimeBudgetApproval(
      {
        id: 'wrong-provider-approval',
        projectId: 'p-payments',
        requestedBy: memberSession.userId,
        approvedBy: leadSession.userId,
        role: 'lead',
        providerId: 'anthropic-default',
        maxAdditionalCostUsd: 1,
        reason: 'This approval belongs to another provider.',
        status: 'approved',
        createdAt: '2026-07-31T00:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
      leadSession,
    )
    const providerFetch = vi.fn()
    const originalFetch = globalThis.fetch
    globalThis.fetch = providerFetch as typeof fetch

    try {
      const result = await resolveTeamRoute('POST', '/api/agent/knowledge-review', repository, {
        session: memberSession,
        body: {
          runId: 'run-payments',
          nodeId: 'node-build',
          projectId: 'p-payments',
          providerId: 'openai-default',
          runtimeBudgetApprovalId: 'wrong-provider-approval',
        },
      })

      expect(result).toMatchObject({
        status: 409,
        body: {
          status: 'blocked',
          budgetDecision: {
            status: 'requires_lead_approval',
            blocksRun: true,
          },
          audit: {
            kind: 'error',
            message: expect.stringContaining('approvalId=wrong-provider-approval'),
          },
        },
      })
      expect(repository.getAgentProviderCredential).not.toHaveBeenCalled()
      expect(providerFetch).not.toHaveBeenCalled()
      expect(repository.saveAgentReviewBundle).not.toHaveBeenCalled()
      expect(repository.saveAgentEvent).toHaveBeenCalledOnce()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('rejects Knowledge Review for a non-current run node before resolving provider credentials', async () => {
    const repository = createRepository()
    const bundle = await repository.getRunsBundle(ownerSession)
    const run = bundle.runs.find((candidate) => candidate.id === 'run-payments')
    if (!run) {
      throw new Error('Expected payments run fixture')
    }
    run.nodes.push({
      ...run.nodes[0]!,
      id: 'node-previous-gate',
      status: 'success',
    })

    const result = await resolveTeamRoute('POST', '/api/agent/knowledge-review', repository, {
      session: memberSession,
      body: {
        runId: run.id,
        nodeId: 'node-previous-gate',
        projectId: run.projectId,
        providerId: 'openai-default',
      },
    })

    expect(result).toEqual({
      status: 400,
      body: {
        error: 'bad_request',
        message: 'Knowledge-Grounded Gate Review requires the current Run node.',
      },
    })
    expect(repository.getAgentProviderCredential).not.toHaveBeenCalled()
    expect(repository.saveAgentReviewBundle).not.toHaveBeenCalled()
  })

  it('rejects Knowledge Review for a non-reviewable current node before resolving provider credentials', async () => {
    const repository = createRepository()
    const bundle = await repository.getRunsBundle(ownerSession)
    const run = bundle.runs.find((candidate) => candidate.id === 'run-payments')
    if (!run) {
      throw new Error('Expected payments run fixture')
    }
    run.nodes[0]!.kind = 'agent'

    const result = await resolveTeamRoute('POST', '/api/agent/knowledge-review', repository, {
      session: memberSession,
      body: {
        runId: run.id,
        nodeId: run.currentNodeId,
        projectId: run.projectId,
        providerId: 'openai-default',
      },
    })

    expect(result).toEqual({
      status: 400,
      body: {
        error: 'bad_request',
        message: 'Knowledge-Grounded Gate Review requires a Gate or Acceptance node.',
      },
    })
    expect(repository.getAgentProviderCredential).not.toHaveBeenCalled()
    expect(repository.saveAgentReviewBundle).not.toHaveBeenCalled()
  })

  it('rejects Knowledge Review for an inactive current node before resolving provider credentials', async () => {
    const repository = createRepository()
    const bundle = await repository.getRunsBundle(ownerSession)
    const run = bundle.runs.find((candidate) => candidate.id === 'run-payments')
    if (!run) {
      throw new Error('Expected payments run fixture')
    }
    run.nodes[0]!.status = 'success'

    const result = await resolveTeamRoute('POST', '/api/agent/knowledge-review', repository, {
      session: memberSession,
      body: {
        runId: run.id,
        nodeId: run.currentNodeId,
        projectId: run.projectId,
        providerId: 'openai-default',
      },
    })

    expect(result).toEqual({
      status: 400,
      body: {
        error: 'bad_request',
        message: 'Knowledge-Grounded Gate Review requires a running or blocked node.',
      },
    })
    expect(repository.getAgentProviderCredential).not.toHaveBeenCalled()
    expect(repository.saveAgentReviewBundle).not.toHaveBeenCalled()
  })

  it('forbids Knowledge Review when the requested project does not match the canonical run', async () => {
    const repository = createRepository()

    const result = await resolveTeamRoute('POST', '/api/agent/knowledge-review', repository, {
      session: ownerSession,
      body: {
        runId: 'run-payments',
        nodeId: 'node-build',
        projectId: 'p-admin',
        providerId: 'openai-default',
      },
    })

    expect(result).toEqual({
      status: 403,
      body: {
        error: 'forbidden',
        message: 'Project access required',
      },
    })
    expect(repository.getAgentProviderCredential).not.toHaveBeenCalled()
    expect(repository.saveAgentReviewBundle).not.toHaveBeenCalled()
  })

  it('runs Knowledge Review for a running current Acceptance node', async () => {
    const repository = createRepository()
    const bundle = await repository.getRunsBundle(ownerSession)
    const run = bundle.runs.find((candidate) => candidate.id === 'run-payments')
    if (!run) {
      throw new Error('Expected payments run fixture')
    }
    run.nodes[0]!.kind = 'acceptance'
    run.nodes[0]!.status = 'running'

    const result = await withFakeRuntime(() =>
      resolveTeamRoute('POST', '/api/agent/knowledge-review', repository, {
        session: memberSession,
        body: {
          runId: run.id,
          nodeId: run.currentNodeId,
          projectId: run.projectId,
          providerId: 'fake-knowledge-review',
        },
      }),
    )

    expect(result?.status).toBe(201)
    expect(repository.saveAgentReviewBundle).toHaveBeenCalledOnce()
  })

  it('rejects fake Knowledge Review unless fake runtime is explicitly enabled', async () => {
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

    expect(result).toEqual({
      status: 400,
      body: {
        error: 'bad_request',
        message: 'Fake Gate Review requires DEVFLOW_ENABLE_FAKE_RUNTIME=true.',
      },
    })
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

  it('does not reveal or read agent reviews for a run outside the member project scope', async () => {
    const repository = createRepository()

    const result = await resolveTeamRoute('GET', '/api/agent/reviews', repository, {
      session: memberSession,
      searchParams: new URLSearchParams('runId=run-admin'),
    })

    expect(result).toEqual({
      status: 404,
      body: {
        error: 'not_found',
        message: 'Run not found',
      },
    })
    expect(repository.listAgentReviews).not.toHaveBeenCalled()
  })

  it('applies the same run scope to project leads without granting organization-wide access', async () => {
    const repository = createRepository()
    const overview = await repository.getTeamOverview(ownerSession)
    addSensitiveOverviewFixtures(overview, 'p-payments', 'run-payments')
    addSensitiveOverviewFixtures(overview, 'p-admin', 'run-admin')
    const accessibleResult = await resolveTeamRoute('GET', '/api/agent/reviews', repository, {
      session: leadSession,
      searchParams: new URLSearchParams('runId=run-payments'),
    })
    const inaccessibleResult = await resolveTeamRoute('GET', '/api/agent/reviews', repository, {
      session: leadSession,
      searchParams: new URLSearchParams('runId=run-admin'),
    })

    expect(accessibleResult).toMatchObject({
      status: 200,
      body: { reviews: [{ id: 'review-payments' }] },
    })
    expect(inaccessibleResult).toEqual({
      status: 404,
      body: { error: 'not_found', message: 'Run not found' },
    })
    expect(repository.listAgentReviews).toHaveBeenCalledTimes(1)
  })

  it('filters an unqualified agent review list to the member accessible projects', async () => {
    const repository = createRepository()
    const overview = await repository.getTeamOverview(ownerSession)
    addSensitiveOverviewFixtures(overview, 'p-payments', 'run-payments')
    addSensitiveOverviewFixtures(overview, 'p-admin', 'run-admin')
    overview.agentReviews.push({
      ...overview.agentReviews[0]!,
      id: 'review-mismatched-run-scope',
      requestId: 'request-mismatched-run-scope',
      runId: 'run-admin',
      projectId: 'p-payments',
      summary: 'must not survive visible Run filtering',
    })

    const result = await resolveTeamRoute('GET', '/api/agent/reviews', repository, {
      session: memberSession,
    })

    expect(result?.status).toBe(200)
    expect(
      (result?.body as { reviews: Array<{ id: string }> }).reviews.map((review) => review.id),
    ).toEqual(['review-payments'])
    expect(JSON.stringify(result)).not.toContain('review-admin')
    expect(JSON.stringify(result)).not.toContain('review-mismatched-run-scope')
  })

  it('uses the same non-enumerable response for an unknown agent review run', async () => {
    const repository = createRepository()

    const result = await resolveTeamRoute('GET', '/api/agent/reviews', repository, {
      session: memberSession,
      searchParams: new URLSearchParams('runId=run-missing'),
    })

    expect(result).toEqual({
      status: 404,
      body: { error: 'not_found', message: 'Run not found' },
    })
    expect(repository.listAgentReviews).not.toHaveBeenCalled()
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

  it('rejects organization enforcement policies for a different organization', async () => {
    const repository = createRepository()
    const policy = createRecommendedEnforcementPreset({
      organizationId: 'org-other',
      updatedAt: '2026-06-16T00:00:00.000Z',
    })

    const result = await resolveTeamRoute('PUT', '/api/enforcement/policy', repository, {
      session: ownerSession,
      body: { organizationPolicy: policy },
    })

    expect(result).toEqual({
      status: 403,
      body: {
        error: 'forbidden',
        message: 'Organization policy must match the authenticated organization',
      },
    })
    expect(repository.saveEnforcementPolicy).not.toHaveBeenCalled()
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

  it('normalizes Postgres-scoped node IDs before canonical Gate evaluation', async () => {
    const repository = createRepository()
    const bundle = await repository.getRunsBundle(ownerSession)
    const paymentsRun = bundle.runs.find((run) => run.id === 'run-payments')!
    repository.getRunsBundle = vi.fn(async () => ({
      ...bundle,
      runs: bundle.runs.map((run) =>
        run.id === paymentsRun.id
          ? {
              ...run,
              currentNodeId: 'run-payments:node-build',
              nodes: run.nodes.map((node) => ({ ...node, id: `run-payments:${node.id}` })),
            }
          : run,
      ),
      artifacts: bundle.artifacts.map((artifact) =>
        artifact.runId === paymentsRun.id
          ? { ...artifact, nodeId: `run-payments:${artifact.nodeId}` }
          : artifact,
      ),
    }))
    const policy = createRecommendedEnforcementPreset({
      organizationId: 'org-demo',
      updatedAt: '2026-06-16T00:00:00.000Z',
    })
    repository.getEnforcementPolicy = vi.fn(async () => ({
      organizationPolicy: policy,
      projectOverride: null,
      effectivePolicy: resolveEffectivePolicy(policy, null),
    }))

    const result = await resolveTeamRoute('POST', '/api/enforcement/evaluate', repository, {
      session: leadSession,
      body: {
        runId: 'run-payments',
        nodeId: 'node-build',
        projectId: 'p-payments',
      },
    })

    expect(result?.status).toBe(200)
    expect(result?.body).toMatchObject({ status: 'blocked', blocksApproval: true })
    const decision = result?.body as {
      blockingReasons: Array<{ id: string; sourceId?: string }>
      warningReasons: Array<{ id: string; sourceId?: string }>
    }
    expect(decision.blockingReasons.length).toBeGreaterThan(0)
    expect(
      [...decision.blockingReasons, ...decision.warningReasons].every(
        (reason) =>
          !reason.id.includes('run-payments:node-build') &&
          !reason.sourceId?.includes('run-payments:node-build'),
      ),
    ).toBe(true)
    expect(JSON.stringify(decision)).not.toContain('run-payments:node-build')
  })

  it('normalizes a namespaced node ID returned by a remote Postgres overview', async () => {
    const repository = createRepository()
    const bundle = await repository.getRunsBundle(ownerSession)
    const paymentsRun = bundle.runs.find((run) => run.id === 'run-payments')!
    repository.getRunsBundle = vi.fn(async () => ({
      ...bundle,
      runs: bundle.runs.map((run) =>
        run.id === paymentsRun.id
          ? {
              ...run,
              currentNodeId: 'run-payments:node-build',
              nodes: run.nodes.map((node) => ({ ...node, id: `run-payments:${node.id}` })),
            }
          : run,
      ),
      artifacts: bundle.artifacts.map((artifact) =>
        artifact.runId === paymentsRun.id
          ? { ...artifact, nodeId: `run-payments:${artifact.nodeId}` }
          : artifact,
      ),
    }))
    const policy = createRecommendedEnforcementPreset({
      organizationId: 'org-demo',
      updatedAt: '2026-06-16T00:00:00.000Z',
    })
    repository.getEnforcementPolicy = vi.fn(async () => ({
      organizationPolicy: policy,
      projectOverride: null,
      effectivePolicy: resolveEffectivePolicy(policy, null),
    }))

    const result = await resolveTeamRoute('POST', '/api/enforcement/evaluate', repository, {
      session: leadSession,
      body: {
        runId: 'run-payments',
        nodeId: 'run-payments:node-build',
        projectId: 'p-payments',
      },
    })

    expect(result?.status).toBe(200)
    expect(result?.body).toMatchObject({ status: 'blocked', blocksApproval: true })
    expect(JSON.stringify(result?.body)).not.toContain('run-payments:node-build')
  })

  it('evaluates runtime budget guard and accepts lead budget approvals', async () => {
    const repository = createRepository()

    const policyResult = await resolveTeamRoute('PUT', '/api/runtime/budget-policy', repository, {
      body: {
        projectId: 'p-payments',
        enabled: true,
        monthlyLimitUsd: 0.02,
        warningThresholdUsd: 0.01,
      },
      session: leadSession,
    })
    expect(policyResult?.status).toBe(200)

    const blocked = await resolveTeamRoute('POST', '/api/runtime/budget/evaluate', repository, {
      body: {
        projectId: 'p-payments',
        providerId: 'double',
        projectedCostUsd: 0.02,
      },
      session: memberSession,
    })
    expect(blocked?.body).toMatchObject({
      status: 'requires_lead_approval',
      blocksRun: true,
    })

    const approval = await resolveTeamRoute('POST', '/api/runtime/budget-approvals', repository, {
      body: {
        projectId: 'p-payments',
        providerId: 'double',
        requestedBy: 'u-yu',
        maxAdditionalCostUsd: 0.05,
        reason: 'Release smoke with real provider is approved.',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
      session: leadSession,
    })
    expect(approval?.status).toBe(201)
    const approvalId = (approval?.body as { id: string }).id

    const allowed = await resolveTeamRoute('POST', '/api/runtime/budget/evaluate', repository, {
      body: {
        projectId: 'p-payments',
        providerId: 'double',
        projectedCostUsd: 0.02,
        approvalId,
      },
      session: memberSession,
    })
    expect(allowed?.body).toMatchObject({
      status: 'approved_over_budget',
      blocksRun: false,
      approvalId,
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

  it('rejects a Gate override when the target project membership is only member', async () => {
    const repository = createRepository()
    const organizationPolicy = createRecommendedEnforcementPreset({
      organizationId: 'org-demo',
      updatedAt: '2026-06-16T00:00:00.000Z',
    })
    const effectivePolicy = resolveEffectivePolicy(organizationPolicy, null)
    repository.getEnforcementPolicy = vi.fn(async () => ({
      organizationPolicy,
      projectOverride: null,
      effectivePolicy,
    }))
    const projectMemberWithGlobalLeadRole: TeamSession = {
      ...leadSession,
      userId: 'u-reviewer',
      authAccountId: 'acct-reviewer',
      projectMemberships: [
        { projectId: 'p-payments', userId: 'u-reviewer', role: 'member' },
      ],
    }

    const result = await resolveTeamRoute('POST', '/api/gates/override', repository, {
      session: projectMemberWithGlobalLeadRole,
      body: {
        runId: 'run-payments',
        nodeId: 'node-build',
        projectId: 'p-payments',
        reason: 'I reviewed the canonical blocker.',
        blockedReasonIds: ['missing_agent_review:protected_gate:missing'],
        policyVersion: effectivePolicy.version,
      },
    })

    expect(result).toMatchObject({ status: 403 })
    expect(repository.saveGateOverride).not.toHaveBeenCalled()
  })

  it('authorizes and audits a Gate override with the target project membership role', async () => {
    const repository = createRepository()
    const organizationPolicy = createRecommendedEnforcementPreset({
      organizationId: 'org-demo',
      updatedAt: '2026-06-16T00:00:00.000Z',
    })
    const effectivePolicy = resolveEffectivePolicy(organizationPolicy, null)
    repository.getEnforcementPolicy = vi.fn(async () => ({
      organizationPolicy,
      projectOverride: null,
      effectivePolicy,
    }))
    const projectLeadWithGlobalMemberRole: TeamSession = {
      ...memberSession,
      userId: 'u-review-lead',
      authAccountId: 'acct-review-lead',
      projectMemberships: [
        { projectId: 'p-payments', userId: 'u-review-lead', role: 'lead' },
      ],
    }

    const result = await resolveTeamRoute('POST', '/api/gates/override', repository, {
      session: projectLeadWithGlobalMemberRole,
      body: {
        runId: 'run-payments',
        nodeId: 'node-build',
        projectId: 'p-payments',
        reason: 'I reviewed the canonical blocker.',
        blockedReasonIds: ['missing_agent_review:protected_gate:missing'],
        policyVersion: effectivePolicy.version,
      },
    })

    expect(result).toMatchObject({
      status: 201,
      body: {
        nodeId: 'node-build',
        userId: 'u-review-lead',
        role: 'lead',
      },
    })
    expect(repository.saveGateOverride).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'node-build',
        userId: 'u-review-lead',
        role: 'lead',
      }),
      projectLeadWithGlobalMemberRole,
    )
  })

  it('rejects a Gate override when its blocker set is stale', async () => {
    const repository = createRepository()
    const organizationPolicy = createRecommendedEnforcementPreset({
      organizationId: 'org-demo',
      updatedAt: '2026-06-16T00:00:00.000Z',
    })
    const effectivePolicy = resolveEffectivePolicy(organizationPolicy, null)
    repository.getEnforcementPolicy = vi.fn(async () => ({
      organizationPolicy,
      projectOverride: null,
      effectivePolicy,
    }))
    const independentLead: TeamSession = {
      ...leadSession,
      userId: 'u-review-lead',
      authAccountId: 'acct-review-lead',
      projectMemberships: [
        { projectId: 'p-payments', userId: 'u-review-lead', role: 'lead' },
      ],
    }

    const result = await resolveTeamRoute('POST', '/api/gates/override', repository, {
      session: independentLead,
      body: {
        runId: 'run-payments',
        nodeId: 'node-build',
        projectId: 'p-payments',
        reason: 'I reviewed the previous blocker.',
        blockedReasonIds: ['stale-blocker'],
        policyVersion: effectivePolicy.version,
      },
    })

    expect(result).toEqual({
      status: 403,
      body: {
        error: 'forbidden',
        message: 'Gate blockers changed; re-evaluate before overriding',
      },
    })
    expect(repository.saveGateOverride).not.toHaveBeenCalled()
  })

  it('rejects approval summary sync because Gate approval must use the enforcement write path', async () => {
    const repository = createRepository()
    const summary = {
      kind: 'approval',
      runId: 'run-1',
      version: 1,
      projectId: 'p-payments',
      title: 'Approve payment workflow',
      status: 'building',
      currentNodeId: 'node-build',
      currentNode: { id: 'node-build', stage: 'build', kind: 'task', status: 'running' },
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
      version: 1,
      projectId: 'p-payments',
      title: 'Update payment workflow',
      status: 'building',
      currentNodeId: 'node-build',
      currentNode: { id: 'node-build', stage: 'build', kind: 'task', status: 'running' },
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

  it('forwards the exact Desktop bearer token record into Run authority checks', async () => {
    const repository = createRepository()
    const summary = {
      kind: 'run',
      runId: 'run-desktop-authority',
      version: 1,
      projectId: 'p-payments',
      title: 'Desktop-owned Run',
      status: 'building',
      currentNodeId: 'node-build',
      currentNode: {
        id: 'node-build',
        stage: 'build',
        kind: 'task',
        status: 'running',
      },
      branchName: 'ai/desktop-authority',
      updatedAt: '2026-08-01T12:00:00.000Z',
    }
    const principal = {
      session: memberSession,
      authentication: {
        kind: 'desktop_bearer' as const,
        tokenRecordId: 'desktop-token-authority',
      },
    }

    const result = await resolveTeamRoute(
      'POST',
      '/api/sync/run-summary',
      repository,
      {
        body: summary,
        session: memberSession,
        principal,
      },
    )

    expect(result?.status).toBe(202)
    expect(repository.uploadRunSummary).toHaveBeenCalledWith(summary, {
      ...memberSession,
      tokenRecordId: 'desktop-token-authority',
    })
  })

  it('rejects a remote summary whose local node ID uses the Team storage namespace', async () => {
    const repository = createRepository()

    const result = await resolveTeamRoute('POST', '/api/sync/run-summary', repository, {
      body: {
        kind: 'run',
        runId: 'run-1',
        version: 1,
        projectId: 'p-payments',
        title: 'Ambiguous node identity',
        status: 'building',
        currentNodeId: 'run-1:node-build',
        currentNode: {
          id: 'run-1:node-build',
          stage: 'build',
          kind: 'task',
          status: 'running',
        },
        branchName: 'ai/payments',
        updatedAt: '2026-06-16T00:00:00.000Z',
      },
      session: memberSession,
    })

    expect(result).toEqual({
      status: 400,
      body: {
        error: 'bad_request',
        message: 'Local node ID uses the reserved Team node namespace.',
      },
    })
    expect(repository.uploadRunSummary).not.toHaveBeenCalled()
  })

  it('returns conflict when a run summary collides with canonical ownership or is stale', async () => {
    const repository = createRepository()
    vi.mocked(repository.uploadRunSummary).mockRejectedValue(
      new RemoteRunSummaryConflictError('run-1', 'p-payments'),
    )

    const result = await resolveTeamRoute('POST', '/api/sync/run-summary', repository, {
      body: {
        kind: 'run',
        runId: 'run-1',
        version: 1,
        projectId: 'p-payments',
        title: 'Stale payment workflow',
        status: 'building',
        currentNodeId: 'node-build',
        currentNode: { id: 'node-build', stage: 'build', kind: 'task', status: 'running' },
        branchName: 'ai/payments',
        updatedAt: '2026-06-15T00:00:00.000Z',
      },
      session: memberSession,
    })

    expect(result).toEqual({
      status: 409,
      body: {
        error: 'conflict',
        message:
          'Remote Run Summary conflicts with canonical ownership or is stale: run-1 (p-payments)',
      },
    })
  })

  it('requires member access for non-approval run summary sync', async () => {
    const repository = createRepository()

    const result = await resolveTeamRoute('POST', '/api/sync/run-summary', repository, {
      body: {
        kind: 'run',
        runId: 'run-1',
        version: 1,
        projectId: 'p-admin',
        title: 'Approve payment workflow',
        status: 'building',
        currentNodeId: 'node-build',
        currentNode: { id: 'node-build', stage: 'build', kind: 'task', status: 'running' },
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

  it('rejects Test Evidence that does not assert redaction', async () => {
    const repository = createRepository()
    const result = await resolveTeamRoute(
      'POST',
      '/api/sync/test-evidence-summary',
      repository,
      {
        body: {
          id: 'evidence-unredacted',
          runId: 'run-1',
          nodeId: 'node-test',
          projectId: 'p-payments',
          command: 'pnpm test',
          status: 'passed',
          exitCode: 0,
          durationMs: 900,
          summary: 'Tests passed.',
          redacted: false,
          createdAt: '2026-06-16T00:01:00.000Z',
        },
        session: memberSession,
      },
    )

    expect(result?.status).toBe(400)
    expect(repository.uploadTestEvidenceSummary).not.toHaveBeenCalled()
  })

  it('redacts paths and secrets embedded in allowed Test Evidence fields before persistence', async () => {
    const repository = createRepository()
    const result = await resolveTeamRoute(
      'POST',
      '/api/sync/test-evidence-summary',
      repository,
      {
        body: {
          id: 'evidence-hostile-fields',
          runId: 'run-1',
          nodeId: 'node-test',
          projectId: 'p-payments',
          command: 'node C:\\Users\\Alice\\repo\\test.js API_TOKEN=command-secret',
          status: 'failed',
          exitCode: 1,
          durationMs: 900,
          summary: 'failed at file:///C:/Users/Alice/repo/test.js GH_TOKEN=summary-secret',
          redacted: true,
          createdAt: '2026-06-16T00:01:00.000Z',
          rawOutput: '/Users/Alice/repo API_TOKEN=unknown-field-secret',
        },
        session: memberSession,
      },
    )

    expect(result?.status).toBe(202)
    const persisted = vi.mocked(repository.uploadTestEvidenceSummary).mock.calls[0]?.[0]
    expect(persisted?.redacted).toBe(true)
    expect(JSON.stringify(persisted)).not.toMatch(/C:[\\/]Users[\\/]Alice/)
    expect(JSON.stringify(persisted)).not.toContain('command-secret')
    expect(JSON.stringify(persisted)).not.toContain('summary-secret')
    expect(persisted).not.toHaveProperty('rawOutput')
  })

  it('returns conflict when evidence arrives before its canonical Run Summary', async () => {
    const repository = createRepository()
    vi.mocked(repository.uploadTestEvidenceSummary).mockRejectedValue(
      new CanonicalRunRequiredError('run-missing', 'p-payments'),
    )

    const result = await resolveTeamRoute(
      'POST',
      '/api/sync/test-evidence-summary',
      repository,
      {
        body: {
          id: 'evidence-orphaned',
          runId: 'run-missing',
          nodeId: 'node-test',
          projectId: 'p-payments',
          command: 'pnpm test',
          status: 'passed',
          exitCode: 0,
          durationMs: 900,
          summary: 'Tests passed before the Run Summary arrived.',
          redacted: true,
          createdAt: '2026-06-16T00:01:00.000Z',
        },
        session: memberSession,
      },
    )

    expect(result).toEqual({
      status: 409,
      body: {
        error: 'conflict',
        message: 'Canonical Run Summary is required before evidence sync: run-missing (p-payments)',
      },
    })
  })

  it('returns conflict when a child summary ID is already bound to another scope', async () => {
    const repository = createRepository()
    vi.mocked(repository.uploadTestEvidenceSummary).mockRejectedValue(
      new RemoteChildSummaryConflictError('evidence-victim', 'run-attacker', 'p-payments'),
    )

    const result = await resolveTeamRoute(
      'POST',
      '/api/sync/test-evidence-summary',
      repository,
      {
        body: {
          id: 'evidence-victim',
          runId: 'run-attacker',
          nodeId: 'node-test',
          projectId: 'p-payments',
          command: 'pnpm test',
          status: 'passed',
          exitCode: 0,
          durationMs: 900,
          summary: 'Attacker attempts to replace victim evidence.',
          redacted: true,
          createdAt: '2026-06-16T00:01:00.000Z',
        },
        session: memberSession,
      },
    )

    expect(result).toEqual({
      status: 409,
      body: {
        error: 'conflict',
        message:
          'Remote child summary ID conflicts with canonical scope: evidence-victim -> run-attacker (p-payments)',
      },
    })
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
      costSummary: {
        id: 'coding-runtime-cost-run-payments-node-build',
        provider: 'openai' as const,
        providerId: 'double',
        model: 'ark-code-latest',
        inputTokens: 120,
        outputTokens: 80,
        cacheReadTokens: 0,
        costUsd: 0.018,
        source: 'estimated' as const,
        redacted: true,
        runId: 'run-payments',
        nodeId: 'node-build',
        projectId: 'p-payments',
        userId: 'u-ling',
        timestamp: '2026-06-16T00:09:00.000Z',
      },
      redacted: true,
    }

    const result = await resolveTeamRoute('POST', '/api/sync/coding-agent-summary', repository, {
      body: summary,
      session: memberSession,
    })

    expect(result?.status).toBe(202)
    expect(repository.uploadCodingAgentSummary).toHaveBeenCalledWith(summary, memberSession)
  })

  it('routes an exact metadata-only Agent Runtime Team projection', async () => {
    const repository = createRepository()
    const summary = {
      stateVersion: 1 as const,
      projectionVersion: 1 as const,
      runtimeId: 'agent-runtime-team-1',
      projectId: 'p-payments',
      runId: 'run-payments',
      nodeId: 'node-build',
      runtimeVersion: 2,
      checkpointVersion: 2,
      status: 'running' as const,
      stopReason: null,
      counters: { steps: 1, toolCalls: 0, tokens: 10, costUsd: 0.01 },
      acceptedActionCount: 1,
      contextDigest: 'a'.repeat(64),
      capabilitySetDigest: 'b'.repeat(64),
      lastObservationDigest: 'c'.repeat(64),
      lastResultDigest: null,
      startedAt: '2026-08-12T20:00:00.000Z',
      updatedAt: '2026-08-12T20:00:01.000Z',
      redacted: true as const,
    }

    const result = await resolveTeamRoute('POST', '/api/sync/agent-runtime-summary', repository, {
      body: summary,
      session: memberSession,
    })

    expect(result?.status).toBe(202)
    expect(repository.uploadAgentRuntimeSummary).toHaveBeenCalledWith(summary, memberSession)
  })

  it('rejects non-exact Agent Runtime projections before repository persistence', async () => {
    const repository = createRepository()
    const result = await resolveTeamRoute('POST', '/api/sync/agent-runtime-summary', repository, {
      body: {
        stateVersion: 1,
        projectionVersion: 1,
        runtimeId: 'agent-runtime-team-1',
        projectId: 'p-payments',
        runId: 'run-payments',
        nodeId: 'node-build',
        runtimeVersion: 2,
        checkpointVersion: 2,
        status: 'running',
        stopReason: null,
        counters: { steps: 1, toolCalls: 0, tokens: 10, costUsd: 0.01 },
        acceptedActionCount: 1,
        contextDigest: 'a'.repeat(64),
        capabilitySetDigest: 'b'.repeat(64),
        lastObservationDigest: 'c'.repeat(64),
        lastResultDigest: null,
        startedAt: '2026-08-12T20:00:00.000Z',
        updatedAt: '2026-08-12T20:00:01.000Z',
        redacted: true,
        rawOutput: 'secret',
      },
      session: memberSession,
    })

    expect(result).toEqual({
      status: 400,
      body: { error: 'bad_request', message: 'Invalid Agent Runtime Team projection payload' },
    })
    expect(repository.uploadAgentRuntimeSummary).not.toHaveBeenCalled()
  })

  it('routes an exact metadata-only Agent Coordination Team projection', async () => {
    const repository = createRepository()
    const summary = {
      stateVersion: 1 as const,
      projectionVersion: 1 as const,
      coordinationId: 'coordination-team-1',
      projectId: 'p-payments',
      runId: 'run-payments',
      nodeId: 'node-build',
      coordinationVersion: 2,
      graphVersion: 1,
      status: 'running' as const,
      stopReason: null,
      roleCounts: [{ roleId: 'contract-reviewer', count: 1 }],
      taskStatusCounts: {
        pending: 0,
        ready: 0,
        running: 1,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
        blocked: 0,
      },
      failureCategoryCounts: {
        timeout: 0,
        budget_exhausted: 0,
        policy_denied: 0,
        tool_error: 0,
        coding_executor_error: 0,
        invalid_result: 0,
        dependency_failed: 0,
      },
      taskCount: 1,
      edgeCount: 0,
      specialistStarts: 1,
      acceptedHandoffCount: 0,
      retryCount: 0,
      stepCount: 0,
      toolCallCount: 0,
      tokenCount: 0,
      costUsd: 0,
      singleAgentQuality: null,
      coordinationQuality: null,
      latencyMs: 500,
      humanInterventionCount: 0,
      authorityViolationCount: 0,
      isolationViolationCount: 0,
      terminationViolationCount: 0,
      replayViolationCount: 0,
      redactionViolationCount: 0,
      updatedAt: '2026-08-13T21:00:00.500Z',
      isolated: true as const,
      redacted: true as const,
    }

    const result = await resolveTeamRoute(
      'POST',
      '/api/sync/agent-coordination-summary',
      repository,
      { body: summary, session: memberSession },
    )

    expect(result?.status).toBe(202)
    expect(repository.uploadAgentCoordinationSummary).toHaveBeenCalledWith(
      summary,
      memberSession,
    )
  })

  it('rejects non-exact Agent Coordination projections before repository persistence', async () => {
    const repository = createRepository()
    const result = await resolveTeamRoute(
      'POST',
      '/api/sync/agent-coordination-summary',
      repository,
      {
        session: memberSession,
        body: {
          stateVersion: 1,
          projectionVersion: 1,
          coordinationId: 'coordination-team-1',
          projectId: 'p-payments',
          runId: 'run-payments',
          nodeId: 'node-build',
          coordinationVersion: 2,
          graphVersion: 1,
          status: 'running',
          stopReason: null,
          roleCounts: [{ roleId: 'contract-reviewer', count: 1 }],
          taskStatusCounts: {
            pending: 0, ready: 0, running: 1, succeeded: 0,
            failed: 0, cancelled: 0, blocked: 0,
          },
          failureCategoryCounts: {
            timeout: 0, budget_exhausted: 0, policy_denied: 0, tool_error: 0,
            coding_executor_error: 0, invalid_result: 0, dependency_failed: 0,
          },
          taskCount: 1,
          edgeCount: 0,
          specialistStarts: 1,
          acceptedHandoffCount: 0,
          retryCount: 0,
          stepCount: 0,
          toolCallCount: 0,
          tokenCount: 0,
          costUsd: 0,
          singleAgentQuality: null,
          coordinationQuality: null,
          latencyMs: 500,
          humanInterventionCount: 0,
          authorityViolationCount: 0,
          isolationViolationCount: 0,
          terminationViolationCount: 0,
          replayViolationCount: 0,
          redactionViolationCount: 0,
          updatedAt: '2026-08-13T21:00:00.500Z',
          isolated: true,
          redacted: true,
          localProjectId: 'private-local-project',
        },
      },
    )

    expect(result).toEqual({
      status: 400,
      body: {
        error: 'bad_request',
        message: 'Invalid Agent Coordination Team projection payload',
      },
    })
    expect(repository.uploadAgentCoordinationSummary).not.toHaveBeenCalled()
  })

  it('routes an exact metadata-only Agent Memory Team projection', async () => {
    const repository = createRepository()
    const summary = {
      stateVersion: 1 as const,
      projectionVersion: 1 as const,
      memoryId: 'agent-memory-team-1',
      projectId: 'p-payments',
      runId: 'run-payments',
      nodeId: 'node-build',
      runtimeId: 'agent-runtime-team-1',
      ownerUserId: 'u-ling',
      candidateId: 'agent-memory-candidate-team-1',
      currentRevision: 1,
      headVersion: 1,
      qualityVersion: 2,
      lifecycleStatus: 'active' as const,
      visibility: 'user_project' as const,
      sensitivity: 'private' as const,
      retentionClass: 'until_deleted' as const,
      provenanceDigest: 'a'.repeat(64),
      citationIds: ['citation-a'],
      retrievalCount: 1,
      acceptedContextCount: 1,
      expiresAt: null,
      deletedAt: null,
      purgeStatus: null,
      purgedAt: null,
      updatedAt: '2026-08-13T12:00:01.000Z',
      redacted: true as const,
    }

    const result = await resolveTeamRoute('POST', '/api/sync/agent-memory-summary', repository, {
      body: summary,
      session: memberSession,
    })

    expect(result?.status).toBe(202)
    expect(repository.uploadAgentMemorySummary).toHaveBeenCalledWith(summary, memberSession)
  })

  it('rejects non-exact Agent Memory projections before repository persistence', async () => {
    const repository = createRepository()
    const result = await resolveTeamRoute('POST', '/api/sync/agent-memory-summary', repository, {
      body: {
        stateVersion: 1,
        projectionVersion: 1,
        memoryId: 'agent-memory-team-1',
        projectId: 'p-payments',
        runId: 'run-payments',
        nodeId: 'node-build',
        runtimeId: 'agent-runtime-team-1',
        ownerUserId: 'u-ling',
        candidateId: 'agent-memory-candidate-team-1',
        currentRevision: 1,
        headVersion: 1,
        qualityVersion: 2,
        lifecycleStatus: 'active',
        visibility: 'user_project',
        sensitivity: 'private',
        retentionClass: 'until_deleted',
        provenanceDigest: 'a'.repeat(64),
        citationIds: ['citation-a'],
        retrievalCount: 1,
        acceptedContextCount: 1,
        expiresAt: null,
        deletedAt: null,
        purgeStatus: null,
        purgedAt: null,
        updatedAt: '2026-08-13T12:00:01.000Z',
        redacted: true,
        statement: 'forbidden raw memory content',
      },
      session: memberSession,
    })

    expect(result).toEqual({
      status: 400,
      body: { error: 'bad_request', message: 'Invalid Agent Memory Team projection payload' },
    })
    expect(repository.uploadAgentMemorySummary).not.toHaveBeenCalled()
  })

  it('projects hostile nested coding metadata before repository persistence', async () => {
    const repository = createRepository()

    const result = await resolveTeamRoute('POST', '/api/sync/coding-agent-summary', repository, {
      body: {
        id: 'coding-hostile-nested-metadata',
        runId: 'run-payments',
        nodeId: 'node-build',
        projectId: 'p-payments',
        requestedBy: 'u-ling',
        providerId: 'fake-coding-engine',
        engine: 'fake',
        status: 'completed',
        branchName: 'devflow/run-payments-node-build',
        summary: 'Coding completed.',
        changedPaths: ['src/export.ts'],
        startedAt: '2026-06-16T00:07:00.000Z',
        costSummary: {
          id: 'cost-hostile-nested-metadata',
          runId: 'run-payments',
          nodeId: 'node-build',
          userId: 'u-ling',
          projectId: 'p-payments',
          provider: 'openai',
          providerId: 'fake-coding-engine',
          model: 'model from /Users/Alice/private API_TOKEN=model-secret',
          inputTokens: 120,
          outputTokens: 80,
          cacheReadTokens: 0,
          costUsd: 0.018,
          timestamp: '2026-06-16T00:09:00.000Z',
          source: 'estimated',
          redacted: true,
          apiKey: 'nested-api-key-secret',
        },
        budgetDecision: {
          status: 'allowed',
          blocksRun: false,
          currentSpendUsd: 1,
          projectedCostUsd: 2,
          reason: 'Approved from C:\\Users\\Alice\\private API_TOKEN=budget-secret',
          token: 'nested-budget-token-secret',
        },
        redacted: true,
      },
      session: memberSession,
    })

    expect(result?.status).toBe(202)
    const persisted = vi.mocked(repository.uploadCodingAgentSummary).mock.calls[0]?.[0]
    expect(persisted?.costSummary?.model).toBe(
      'model from [REDACTED:local_absolute_path] [REDACTED:env_secret_assignment]',
    )
    expect(persisted?.budgetDecision?.reason).toBe(
      'Approved from [REDACTED:local_absolute_path] [REDACTED:env_secret_assignment]',
    )
    expect(persisted?.costSummary).not.toHaveProperty('apiKey')
    expect(persisted?.budgetDecision).not.toHaveProperty('token')
    expect(JSON.stringify(persisted)).not.toContain('model-secret')
    expect(JSON.stringify(persisted)).not.toContain('budget-secret')
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

  it('rejects coding cost summaries that carry raw prompt text', async () => {
    const repository = createRepository()

    const result = await resolveTeamRoute('POST', '/api/sync/coding-agent-summary', repository, {
      body: {
        id: 'coding-run-1',
        runId: 'run-payments',
        nodeId: 'node-build',
        projectId: 'p-payments',
        requestedBy: 'u-ling',
        providerId: 'double',
        engine: 'opencode-http',
        status: 'completed',
        branchName: 'devflow/run-payments-node-build',
        summary: 'Should be rejected.',
        changedPaths: ['src/export.ts'],
        startedAt: '2026-06-16T00:07:00.000Z',
        redacted: true,
        costSummary: {
          id: 'coding-runtime-cost-run-payments-node-build',
          provider: 'openai',
          providerId: 'double',
          model: 'ark-code-latest',
          inputTokens: 120,
          outputTokens: 80,
          cacheReadTokens: 0,
          costUsd: 0.018,
          source: 'estimated',
          redacted: true,
          runId: 'run-payments',
          nodeId: 'node-build',
          projectId: 'p-payments',
          userId: 'u-ling',
          timestamp: '2026-06-16T00:09:00.000Z',
          prompt: 'raw prompt must stay local',
        },
      },
      session: memberSession,
    })

    expect(result).toEqual({
      status: 400,
      body: {
        error: 'bad_request',
        message: 'Invalid remote coding agent summary payload',
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
          version: 1,
          projectId: 'p-payments',
          title: 'Approve payment workflow',
          status: 'building',
          currentNodeId: 'node-build',
          currentNode: { id: 'node-build', stage: 'build', kind: 'task', status: 'running' },
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
