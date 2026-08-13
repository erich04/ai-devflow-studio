import { describe, expect, it } from 'vitest'
import {
  createRecommendedEnforcementPreset,
  type GateOverrideDecision,
} from '@ai-devflow/shared'
import type { RequestPrincipal } from '../auth/request-auth'
import type { GitHubDeliverySessionPrincipal } from './github-delivery-contract'
import { createSeedTeamRepository } from './team-repository'
import { evaluateTeamGateEnforcement } from './team-gate-enforcement'

const gateBrowserPrincipal: RequestPrincipal = {
  session: {
    source: 'authenticated',
    authAccountId: 'acct-demo-u-ling',
    organizationId: 'org-demo',
    userId: 'u-ling',
    role: 'lead',
    projectMemberships: [
      { projectId: 'p-payments', userId: 'u-ling', role: 'lead' },
    ],
  },
  authentication: { kind: 'session_cookie', tokenRecordId: null },
}

const gateDesktopPrincipal: RequestPrincipal = {
  session: {
    source: 'authenticated',
    authAccountId: 'acct-demo-u-wang',
    organizationId: 'org-demo',
    userId: 'u-wang',
    role: 'member',
    projectMemberships: [
      { projectId: 'p-payments', userId: 'u-wang', role: 'member' },
    ],
  },
  authentication: {
    kind: 'desktop_bearer',
    tokenRecordId: 'desktop-token-team-repository-gate',
  },
}

const githubOwnerPrincipal: GitHubDeliverySessionPrincipal = {
  session: {
    source: 'authenticated',
    authAccountId: 'acct-demo-u-erich',
    organizationId: 'org-demo',
    userId: 'u-erich',
    role: 'owner',
    projectMemberships: [],
  },
  authentication: { kind: 'session_cookie', tokenRecordId: null },
}

async function materializeSeedGateRun(
  repository: ReturnType<typeof createSeedTeamRepository>,
  runId: string,
  suffix: string,
) {
  const created = await repository.createWorkRequest(
    {
      projectId: 'p-payments',
      title: `Gate repository test ${suffix}`,
      request: 'Keep Gate command authority bound to one materialized Run.',
      idempotencyKey: `work-request:create:${suffix}`,
      expiresAt: null,
    },
    gateBrowserPrincipal,
  )
  if (!created.ok) throw new Error('Work Request create failed.')
  const claimed = await repository.claimWorkRequest(
    {
      workRequestId: created.workRequest.id,
      expectedVersion: 1,
      runId,
      idempotencyKey: `work-request:claim:${suffix}`,
    },
    gateDesktopPrincipal,
  )
  if (!claimed.ok) throw new Error('Work Request claim failed.')
  const materialized = await repository.materializeWorkRequest(
    {
      workRequestId: created.workRequest.id,
      expectedVersion: 2,
      runId,
      idempotencyKey: `work-request:materialize:${suffix}`,
    },
    gateDesktopPrincipal,
  )
  if (!materialized.ok) throw new Error('Work Request materialization failed.')
}

describe('seed team repository', () => {
  const syncContext = { organizationId: 'org-demo', userId: 'u-erich' }

  it('stores only a monotonic metadata-only Agent Runtime Team projection', async () => {
    const repository = createSeedTeamRepository()
    await repository.uploadRunSummary({
      kind: 'run',
      runId: 'run-runtime-projection-1',
      version: 3,
      projectId: 'p-payments',
      title: 'Runtime projection',
      status: 'building',
      currentNodeId: 'node-build',
      currentNode: { id: 'node-build', stage: 'build', kind: 'task', status: 'running' },
      branchName: 'codex/runtime-projection',
      updatedAt: '2026-08-12T20:00:00.000Z',
    }, syncContext)
    const summary = {
      stateVersion: 1 as const,
      projectionVersion: 1 as const,
      runtimeId: 'agent-runtime-team-1',
      projectId: 'p-payments',
      runId: 'run-runtime-projection-1',
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

    await expect(repository.uploadAgentRuntimeSummary(summary, syncContext)).resolves.toMatchObject({
      accepted: true,
    })
    const reorderedSummary = Object.fromEntries(
      Object.entries(summary).reverse(),
    ) as typeof summary
    await expect(
      repository.uploadAgentRuntimeSummary(reorderedSummary, syncContext),
    ).resolves.toMatchObject({ accepted: true })
    await expect(repository.uploadAgentRuntimeSummary(summary, syncContext)).resolves.toMatchObject({
      accepted: true,
    })
    await expect(repository.uploadAgentRuntimeSummary({
      ...summary,
      runtimeVersion: 1,
      checkpointVersion: 1,
    }, syncContext)).rejects.toThrow('Remote child summary ID conflicts')

    const overview = await repository.getTeamOverview(syncContext)
    expect(overview.agentRuntimeSummaries).toEqual([summary])
    expect(JSON.stringify(overview.agentRuntimeSummaries)).not.toMatch(
      /localProjectId|userId|sessionId|source|path|output|checkpointData/i,
    )
  })

  it('stores only one monotonic metadata-only Agent Coordination Team projection', async () => {
    const repository = createSeedTeamRepository()
    await repository.uploadRunSummary({
      kind: 'run',
      runId: 'run-coordination-projection-1',
      version: 3,
      projectId: 'p-payments',
      title: 'Coordination projection',
      status: 'building',
      currentNodeId: 'node-build',
      currentNode: { id: 'node-build', stage: 'build', kind: 'task', status: 'running' },
      branchName: 'codex/coordination-projection',
      updatedAt: '2026-08-13T21:00:00.000Z',
    }, syncContext)
    const summary = {
      stateVersion: 1 as const,
      projectionVersion: 1 as const,
      coordinationId: 'coordination-team-1',
      projectId: 'p-payments',
      runId: 'run-coordination-projection-1',
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

    await expect(
      repository.uploadAgentCoordinationSummary(summary, syncContext),
    ).resolves.toMatchObject({ accepted: true })
    await expect(repository.uploadAgentCoordinationSummary(
      Object.fromEntries(Object.entries(summary).reverse()) as typeof summary,
      syncContext,
    )).resolves.toMatchObject({ accepted: true })
    await expect(repository.uploadAgentCoordinationSummary({
      ...summary,
      coordinationVersion: 1,
    }, syncContext)).rejects.toThrow('Remote child summary ID conflicts')
    await expect(repository.uploadAgentCoordinationSummary({
      ...summary,
      projectId: 'p-platform',
    }, syncContext)).rejects.toThrow('Remote child summary ID conflicts')

    const terminal = {
      ...summary,
      coordinationVersion: 3,
      status: 'terminal' as const,
      stopReason: 'success' as const,
      taskStatusCounts: {
        ...summary.taskStatusCounts,
        running: 0,
        succeeded: 1,
      },
      singleAgentQuality: 0.5,
      coordinationQuality: 0.8,
      latencyMs: 1_000,
      updatedAt: '2026-08-13T21:00:01.000Z',
    }
    await expect(
      repository.uploadAgentCoordinationSummary(terminal, syncContext),
    ).resolves.toMatchObject({ accepted: true })
    await expect(repository.uploadAgentCoordinationSummary({
      ...terminal,
      latencyMs: 1_001,
    }, syncContext)).rejects.toThrow('Remote child summary ID conflicts')

    const overview = await repository.getTeamOverview(syncContext)
    expect(overview.agentCoordinationSummaries).toEqual([terminal])
    expect(JSON.stringify(overview.agentCoordinationSummaries)).not.toMatch(
      /localProjectId|userId|sessionId|contextDigest|capability|resource|source|path|output|patch/iu,
    )
  })

  it('stores only a monotonic metadata-only Agent Memory Team projection', async () => {
    const repository = createSeedTeamRepository()
    await repository.uploadRunSummary({
      kind: 'run',
      runId: 'run-memory-projection-1',
      version: 3,
      projectId: 'p-payments',
      title: 'Memory projection',
      status: 'building',
      currentNodeId: 'node-build',
      currentNode: { id: 'node-build', stage: 'build', kind: 'task', status: 'running' },
      branchName: 'codex/memory-projection',
      updatedAt: '2026-08-13T12:00:00.000Z',
    }, syncContext)
    const summary = {
      stateVersion: 1 as const,
      projectionVersion: 1 as const,
      memoryId: 'agent-memory-team-1',
      projectId: 'p-payments',
      runId: 'run-memory-projection-1',
      nodeId: 'node-build',
      runtimeId: 'agent-runtime-team-1',
      ownerUserId: 'u-erich',
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

    await expect(repository.uploadAgentMemorySummary({
      ...summary,
      qualityVersion: 0,
    }, syncContext)).rejects.toThrow('Remote child summary ID conflicts')
    await expect(repository.uploadAgentMemorySummary(summary, syncContext)).resolves.toMatchObject({
      accepted: true,
    })
    await expect(repository.uploadAgentMemorySummary(summary, syncContext)).resolves.toMatchObject({
      accepted: true,
    })
    const qualityAdvanced = {
      ...summary,
      qualityVersion: 3,
      citationIds: ['citation-a', 'citation-b'],
      retrievalCount: 2,
      acceptedContextCount: 2,
      updatedAt: '2026-08-13T12:00:02.000Z',
    }
    await expect(
      repository.uploadAgentMemorySummary(qualityAdvanced, syncContext),
    ).resolves.toMatchObject({ accepted: true })
    const sameTimestampQualityAdvanced = {
      ...qualityAdvanced,
      qualityVersion: 4,
      citationIds: ['citation-a', 'citation-b', 'citation-c'],
      retrievalCount: 3,
      acceptedContextCount: 3,
    }
    await expect(
      repository.uploadAgentMemorySummary(sameTimestampQualityAdvanced, syncContext),
    ).resolves.toMatchObject({ accepted: true })
    const advanced = {
      ...sameTimestampQualityAdvanced,
      headVersion: 2,
      updatedAt: '2026-08-13T12:00:03.000Z',
    }
    await expect(repository.uploadAgentMemorySummary(advanced, syncContext)).resolves.toMatchObject({
      accepted: true,
    })
    await expect(repository.uploadAgentMemorySummary({
      ...advanced,
      headVersion: 3,
      citationIds: ['citation-b'],
    }, syncContext)).rejects.toThrow('Remote child summary ID conflicts')
    await expect(repository.uploadAgentMemorySummary(summary, syncContext)).rejects.toThrow(
      'Remote child summary ID conflicts',
    )

    const overview = await repository.getTeamOverview(syncContext)
    expect(overview.agentMemorySummaries).toEqual([advanced])
    expect(JSON.stringify(overview.agentMemorySummaries)).not.toMatch(
      /statement|contentDigest|localProjectId|sessionId|prompt|reasoning|credential|path|rawOutput/iu,
    )
  })

  it('exposes GitHub Delivery repository authority through the unified Team repository', async () => {
    const repository = createSeedTeamRepository()

    await expect(
      repository.upsertGitHubRepositoryBinding(
        {
          projectId: 'p-payments',
          installationId: '12345',
          repositoryId: '98765',
          repository: 'example/project',
          defaultBranch: 'main',
          verifiedAt: '2026-08-11T15:00:00.000Z',
          expectedStateVersion: 0,
        },
        githubOwnerPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      outcomeCode: 'binding_created',
      binding: {
        teamProjectId: 'p-payments',
        repository: 'example/project',
        redacted: true,
      },
    })
  })

  it('loads Gate enforcement inputs sequentially for transaction-backed repositories', async () => {
    const source = createSeedTeamRepository()
    const runId = 'run-gate-serial-preflight'
    const nodeId = 'node-design-gate'
    await materializeSeedGateRun(source, runId, 'serial-preflight')
    await source.uploadRunSummary(
      {
        kind: 'run',
        runId,
        version: 3,
        projectId: 'p-payments',
        title: 'Serial Gate preflight',
        status: 'paused_at_gate',
        currentNodeId: nodeId,
        currentNode: {
          id: nodeId,
          stage: 'design',
          kind: 'gate',
          status: 'blocked',
          requiredRole: 'lead',
        },
        branchName: 'codex/gate-serial-preflight',
        updatedAt: '2026-07-31T12:10:00.000Z',
      },
      {
        ...gateDesktopPrincipal.session,
        tokenRecordId: gateDesktopPrincipal.authentication.tokenRecordId,
      },
    )

    let activeRead = false
    const calls: string[] = []
    async function guarded<T>(label: string, read: () => Promise<T>): Promise<T> {
      if (activeRead) throw new Error('concurrent transaction query')
      activeRead = true
      calls.push(label)
      try {
        await Promise.resolve()
        return await read()
      } finally {
        activeRead = false
      }
    }
    const repository = {
      getRunsBundle: (...args: Parameters<typeof source.getRunsBundle>) =>
        guarded('runs', () => source.getRunsBundle(...args)),
      getTeamOverview: (...args: Parameters<typeof source.getTeamOverview>) =>
        guarded('overview', () => source.getTeamOverview(...args)),
      getEnforcementPolicy: (
        ...args: Parameters<typeof source.getEnforcementPolicy>
      ) => guarded('policy', () => source.getEnforcementPolicy(...args)),
      listGateOverrides: (...args: Parameters<typeof source.listGateOverrides>) =>
        guarded('overrides', () => source.listGateOverrides(...args)),
    }

    await expect(
      evaluateTeamGateEnforcement(repository, gateBrowserPrincipal.session, {
        projectId: 'p-payments',
        runId,
        nodeId,
      }),
    ).resolves.toMatchObject({ run: { id: runId }, node: { id: nodeId } })
    expect(calls).toEqual(['runs', 'overview', 'policy', 'overrides'])
  })

  it('does not inject a historical Gate override into a non-blocking enforcement decision', async () => {
    const repository = createSeedTeamRepository()
    const runId = 'run-gate-pass-history'
    const nodeId = 'node-design-gate'
    await materializeSeedGateRun(repository, runId, 'pass-history')
    await repository.uploadRunSummary(
      {
        kind: 'run',
        runId,
        version: 3,
        projectId: 'p-payments',
        title: 'Non-blocking Gate history',
        status: 'paused_at_gate',
        currentNodeId: nodeId,
        currentNode: {
          id: nodeId,
          stage: 'design',
          kind: 'gate',
          status: 'blocked',
          requiredRole: 'lead',
        },
        branchName: 'codex/gate-pass-history',
        updatedAt: '2026-07-31T12:10:00.000Z',
      },
      {
        ...gateDesktopPrincipal.session,
        tokenRecordId: gateDesktopPrincipal.authentication.tokenRecordId,
      },
    )
    await repository.saveGateOverride(
      {
        id: 'gate-override-stale-pass-history',
        runId,
        nodeId,
        projectId: 'p-payments',
        userId: 'u-ling',
        role: 'lead',
        reason: 'This decision belongs to an obsolete policy snapshot.',
        blockedReasonIds: ['obsolete-blocker'],
        policyVersion: 999,
        provisional: false,
        status: 'accepted',
        createdAt: '2026-07-31T12:00:00.000Z',
      },
      gateBrowserPrincipal.session,
    )

    await expect(
      repository.createGateCommand(
        {
          projectId: 'p-payments',
          runId,
          nodeId,
          action: 'approve',
          reason: 'Approve the current non-blocking policy snapshot.',
          expectedRunVersion: 3,
          expectedPolicyVersion: 1,
          expectedBlockerIds: [],
          idempotencyKey: 'gate-command:create:pass-history:v1',
        },
        gateBrowserPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      responseStatus: 201,
      outcomeCode: 'created',
    })
  })

  it('selects only the exact accepted non-provisional override for the current overridden decision', async () => {
    const repository = createSeedTeamRepository()
    const runId = 'run-gate-exact-override'
    const nodeId = 'node-design-gate'
    await materializeSeedGateRun(repository, runId, 'exact-override')
    await repository.uploadRunSummary(
      {
        kind: 'run',
        runId,
        version: 3,
        projectId: 'p-payments',
        title: 'Exact Gate override',
        status: 'paused_at_gate',
        currentNodeId: nodeId,
        currentNode: {
          id: nodeId,
          stage: 'design',
          kind: 'gate',
          status: 'blocked',
          requiredRole: 'lead',
        },
        branchName: 'codex/gate-exact-override',
        updatedAt: '2026-07-31T12:10:00.000Z',
      },
      {
        ...gateDesktopPrincipal.session,
        tokenRecordId: gateDesktopPrincipal.authentication.tokenRecordId,
      },
    )
    await repository.saveEnforcementPolicy(
      createRecommendedEnforcementPreset({ organizationId: 'org-demo' }),
      gateBrowserPrincipal.session,
    )
    const blockedContext = await evaluateTeamGateEnforcement(
      repository,
      gateBrowserPrincipal.session,
      { projectId: 'p-payments', runId, nodeId },
    )
    expect(blockedContext.decision).toMatchObject({
      status: 'blocked',
      blocksApproval: true,
      canOverride: true,
    })
    const blockerIds = blockedContext.decision.blockingReasons
      .map((reason) => reason.id)
      .sort()
    const exactOverride: GateOverrideDecision = {
      id: 'gate-override-exact-current',
      runId,
      nodeId,
      projectId: 'p-payments',
      userId: 'u-ling',
      role: 'lead',
      reason: 'Independently reviewed every current blocker.',
      blockedReasonIds: blockerIds,
      policyVersion: blockedContext.decision.policyVersion,
      provisional: false,
      status: 'accepted',
      createdAt: '2026-07-31T12:20:00.000Z',
    }
    await repository.saveGateOverride(
      exactOverride,
      gateBrowserPrincipal.session,
    )
    const invalidOverrides: GateOverrideDecision[] = [
      { ...exactOverride, id: 'gate-override-rejected', status: 'rejected' },
      { ...exactOverride, id: 'gate-override-provisional', provisional: true },
      { ...exactOverride, id: 'gate-override-project', projectId: 'p-admin' },
      { ...exactOverride, id: 'gate-override-role', role: 'owner' },
      {
        ...exactOverride,
        id: 'gate-override-policy',
        policyVersion: exactOverride.policyVersion + 1,
      },
      {
        ...exactOverride,
        id: 'gate-override-blockers',
        blockedReasonIds: ['obsolete-blocker'],
      },
      {
        ...exactOverride,
        id: 'gate-override-noncanonical-blockers',
        blockedReasonIds: [...blockerIds, blockerIds[0]!],
      },
      { ...exactOverride, id: 'gate-override-node', nodeId: 'node-other' },
      { ...exactOverride, id: 'gate-override-user', userId: 'u-erich' },
    ]
    for (const override of invalidOverrides) {
      await repository.saveGateOverride(override, gateBrowserPrincipal.session)
    }
    const overriddenContext = await evaluateTeamGateEnforcement(
      repository,
      gateBrowserPrincipal.session,
      { projectId: 'p-payments', runId, nodeId },
    )
    expect(overriddenContext.decision).toMatchObject({
      status: 'overridden',
      blocksApproval: false,
    })

    await expect(
      repository.createGateCommand(
        {
          projectId: 'p-payments',
          runId,
          nodeId,
          action: 'approve',
          reason: 'Use only the exact current accepted override.',
          expectedRunVersion: 3,
          expectedPolicyVersion: blockedContext.decision.policyVersion,
          expectedBlockerIds: blockerIds,
          idempotencyKey: 'gate-command:create:exact-override:v3',
        },
        gateBrowserPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      responseStatus: 201,
      outcomeCode: 'created',
    })
  })

  it('rejects evidence summaries until a canonical Run Summary exists', async () => {
    const repository = createSeedTeamRepository()

    await expect(
      repository.uploadTestEvidenceSummary(
        {
          id: 'evidence-orphaned',
          runId: 'run-orphaned',
          nodeId: 'node-test',
          projectId: 'project-1',
          command: 'pnpm test',
          status: 'passed',
          exitCode: 0,
          durationMs: 900,
          summary: 'Tests passed without a canonical Run Summary.',
          redacted: true,
          createdAt: '2026-06-16T00:01:00.000Z',
        },
        syncContext,
      ),
    ).rejects.toThrow('Canonical Run Summary is required before evidence sync')
  })

  it('exposes team overview data through the repository boundary', async () => {
    const repository = createSeedTeamRepository()
    const overview = await repository.getTeamOverview(syncContext)

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
    expect(
      overview.enforcementPolicies.effectivePolicies.map((policy) => policy.projectId),
    ).toEqual(overview.projects.map((project) => project.id))
  })

  it('scopes the effective policy returned for a project without an override', async () => {
    const repository = createSeedTeamRepository()

    const result = await repository.getEnforcementPolicy('p-payments', syncContext)

    expect(result.projectOverride).toBeNull()
    expect(result.effectivePolicy.projectId).toBe('p-payments')
  })

  it('does not expose seed organization projects or runs through another organization context', async () => {
    const repository = createSeedTeamRepository()
    const context = { organizationId: 'org-other' }

    const [overview, bundle] = await Promise.all([
      repository.getTeamOverview(context),
      repository.getRunsBundle(context),
    ])

    expect(bundle).toEqual({ runs: [], artifacts: [], events: [] })
    expect(overview.projects).toEqual([])
    expect(overview.runs).toEqual([])
    expect(overview.projectCost).toEqual([])
    expect(overview.totalCost).toBe('$0.00')
    expect(overview.enforcementPolicies.organizationPolicy.organizationId).toBe('org-other')
  })

  it('redacts allowed Test Evidence fields again at the repository write boundary', async () => {
    const repository = createSeedTeamRepository()
    await repository.uploadRunSummary({
      kind: 'run',
      runId: 'run-hostile-evidence',
      version: 1,
      projectId: 'project-1',
      title: 'Repository redaction boundary',
      status: 'testing',
      currentNodeId: 'node-test',
      currentNode: { id: 'node-test', stage: 'test', kind: 'test', status: 'running' },
      branchName: 'ai/repository-redaction',
      updatedAt: '2026-06-16T00:00:00.000Z',
    }, syncContext)

    await repository.uploadTestEvidenceSummary({
      id: 'evidence-hostile-fields',
      runId: 'run-hostile-evidence',
      nodeId: 'node-test',
      projectId: 'project-1',
      command: 'node C:\\Users\\Alice\\repo\\test.js API_TOKEN=command-secret',
      status: 'failed',
      exitCode: 1,
      durationMs: 10,
      summary: 'failed at file:///C:/Users/Alice/repo/test.js GH_TOKEN=summary-secret',
      redacted: false,
      createdAt: '2026-06-16T00:01:00.000Z',
      rawOutput: '/Users/Alice/repo API_TOKEN=unknown-field-secret',
    } as Parameters<typeof repository.uploadTestEvidenceSummary>[0], syncContext)

    const persisted = (await repository.getTeamOverview(syncContext)).testEvidenceSummaries.find(
      (summary) => summary.id === 'evidence-hostile-fields',
    )
    expect(persisted?.redacted).toBe(true)
    expect(JSON.stringify(persisted)).not.toMatch(/C:[\\/]Users[\\/]Alice/)
    expect(JSON.stringify(persisted)).not.toContain('command-secret')
    expect(JSON.stringify(persisted)).not.toContain('summary-secret')
    expect(persisted).not.toHaveProperty('rawOutput')
  })

  it('redacts Run title and branch name again at the repository write boundary', async () => {
    const repository = createSeedTeamRepository()

    await repository.uploadRunSummary(
      {
        kind: 'run',
        runId: 'run-hostile-metadata',
        version: 1,
        projectId: 'project-1',
        title: 'Build from /Users/Alice/private/repo API_TOKEN=title-secret',
        status: 'building',
        currentNodeId: 'node-build',
        currentNode: { id: 'node-build', stage: 'build', kind: 'task', status: 'running' },
        branchName: 'C:\\Users\\Alice\\private\\branch API_TOKEN=branch-secret',
        updatedAt: '2026-06-16T00:00:00.000Z',
      },
      syncContext,
    )

    const run = (await repository.getRunsBundle(syncContext)).runs.find(
      (candidate) => candidate.id === 'run-hostile-metadata',
    )
    expect(JSON.stringify(run)).not.toContain('title-secret')
    expect(JSON.stringify(run)).not.toContain('branch-secret')
    expect(JSON.stringify(run)).not.toContain('/Users/Alice')
    expect(JSON.stringify(run)).not.toMatch(/C:[\\/]Users[\\/]Alice/)
  })

  it('redacts Coding Summary branch and summary again at the repository write boundary', async () => {
    const repository = createSeedTeamRepository()
    await repository.uploadRunSummary(
      {
        kind: 'run',
        runId: 'run-hostile-coding-metadata',
        version: 1,
        projectId: 'project-1',
        title: 'Coding metadata boundary',
        status: 'building',
        currentNodeId: 'node-build',
        currentNode: { id: 'node-build', stage: 'build', kind: 'task', status: 'running' },
        branchName: 'ai/coding-metadata-boundary',
        updatedAt: '2026-06-16T00:00:00.000Z',
      },
      syncContext,
    )

    await repository.uploadCodingAgentSummary(
      {
        id: 'coding-hostile-metadata',
        runId: 'run-hostile-coding-metadata',
        nodeId: 'node-build',
        projectId: 'project-1',
        requestedBy: syncContext.userId,
        providerId: 'fake-coding-engine',
        engine: 'fake',
        status: 'completed',
        branchName: 'C:\\Users\\Alice\\private\\branch API_TOKEN=branch-secret',
        summary: 'Changed /Users/Alice/private/repo API_TOKEN=summary-secret',
        changedPaths: ['src/export.ts'],
        startedAt: '2026-06-16T00:01:00.000Z',
        completedAt: '2026-06-16T00:02:00.000Z',
        costSummary: {
          id: 'cost-hostile-metadata',
          runId: 'run-hostile-coding-metadata',
          nodeId: 'node-build',
          userId: syncContext.userId,
          projectId: 'project-1',
          provider: 'openai',
          providerId: 'fake-coding-engine',
          model: 'model from /Users/Alice/private/model API_TOKEN=model-secret',
          inputTokens: 12,
          outputTokens: 3,
          cacheReadTokens: 1,
          costUsd: 0.02,
          timestamp: '2026-06-16T00:02:00.000Z',
          source: 'estimated',
          redacted: true,
          apiKey: 'nested-api-key-secret',
        },
        budgetDecision: {
          status: 'allowed',
          blocksRun: false,
          currentSpendUsd: 1,
          projectedCostUsd: 2,
          reason: 'Approved from /Users/Alice/private/repo API_TOKEN=budget-secret',
          token: 'nested-budget-token-secret',
        },
        redacted: true,
      } as Parameters<typeof repository.uploadCodingAgentSummary>[0],
      syncContext,
    )

    const stored = (await repository.getTeamOverview(syncContext)).codingAgentSummaries.find(
      (summary) => summary.id === 'coding-hostile-metadata',
    )
    expect(JSON.stringify(stored)).not.toContain('branch-secret')
    expect(JSON.stringify(stored)).not.toContain('summary-secret')
    expect(JSON.stringify(stored)).not.toContain('budget-secret')
    expect(JSON.stringify(stored)).not.toContain('model-secret')
    expect(JSON.stringify(stored)).not.toContain('nested-api-key-secret')
    expect(JSON.stringify(stored)).not.toContain('nested-budget-token-secret')
    expect(JSON.stringify(stored)).not.toContain('/Users/Alice')
    expect(JSON.stringify(stored)).not.toMatch(/C:[\\/]Users[\\/]Alice/)
    expect(stored?.costSummary).not.toHaveProperty('apiKey')
    expect(stored?.budgetDecision).not.toHaveProperty('token')
  })

  it('returns workflow runs with their artifacts and events', async () => {
    const repository = createSeedTeamRepository()
    const bundle = await repository.getRunsBundle(syncContext)

    expect(bundle.runs[0]?.id).toBe('run-health-001')
    expect(bundle.artifacts.every((artifact) => artifact.runId === 'run-health-001')).toBe(true)
    expect(bundle.events.every((event) => event.runId === 'run-health-001')).toBe(true)
  })

  it('keeps a standalone Knowledge Review budget-block event visible and redacted', async () => {
    const repository = createSeedTeamRepository()

    const saved = await repository.saveAgentEvent(
      {
        id: 'knowledge-review-budget-audit-seed',
        runId: 'run-health-001',
        nodeId: 'n-design-gate',
        sequence: 99,
        kind: 'error',
        message:
          'Knowledge Review budget blocked. status=unavailable reason=/Users/Alice/private API_TOKEN=seed-secret',
        timestamp: '2026-07-31T00:00:00.000Z',
      },
      syncContext,
    )

    expect(saved.message).toBe(
      'Knowledge Review budget blocked. status=unavailable reason=[REDACTED:local_absolute_path] [REDACTED:env_secret_assignment]',
    )
    const persisted = (await repository.getRunsBundle(syncContext)).events.find(
      (event) => event.id === saved.id,
    )
    expect(persisted).toEqual(saved)
    expect(JSON.stringify(persisted)).not.toContain('seed-secret')
    expect(JSON.stringify(persisted)).not.toContain('/Users/Alice')
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

  it('resolves browser sessions from stable account identity without cookie authorization state', async () => {
    const repository = createSeedTeamRepository()

    await expect(repository.resolveBrowserSession('acct-demo-u-ling')).resolves.toEqual({
      source: 'authenticated',
      organizationId: 'org-demo',
      userId: 'u-ling',
      role: 'lead',
      authAccountId: 'acct-demo-u-ling',
      projectMemberships: [
        { projectId: 'p-payments', userId: 'u-ling', role: 'lead' },
        { projectId: 'p-admin', userId: 'u-ling', role: 'lead' },
      ],
    })
    await expect(repository.resolveBrowserSession('acct-demo-missing')).resolves.toBeNull()
  })

  it('keeps the seed desktop pairing token scoped to the pairing creator role', async () => {
    const repository = createSeedTeamRepository()
    const leadContext = {
      source: 'authenticated' as const,
      organizationId: 'org-demo',
      userId: 'u-ling',
      role: 'lead' as const,
      authAccountId: 'acct-demo-u-ling',
      projectMemberships: [{ projectId: 'p-payments', userId: 'u-ling', role: 'lead' as const }],
    }
    const pairing = await repository.createDesktopPairingCode(
      { projectId: 'p-payments' },
      leadContext,
    )

    const exchange = await repository.exchangeDesktopPairingCode({ code: pairing.code })

    await expect(repository.resolveDesktopTokenSession(exchange.token)).resolves.toMatchObject({
      tokenRecordId: exchange.tokenId,
      session: {
        userId: 'u-ling',
        role: 'lead',
        projectMemberships: [{ projectId: 'p-payments', userId: 'u-ling', role: 'lead' }],
      },
    })
  })

  it('limits seed owner pairing tokens to lead authority on the paired project', async () => {
    const repository = createSeedTeamRepository()
    const ownerContext = {
      source: 'authenticated' as const,
      organizationId: 'org-demo',
      userId: 'u-erich',
      role: 'owner' as const,
      authAccountId: 'acct-demo-erich',
      projectMemberships: [
        { projectId: 'p-payments', userId: 'u-erich', role: 'owner' as const },
        { projectId: 'p-admin', userId: 'u-erich', role: 'owner' as const },
      ],
    }
    const pairing = await repository.createDesktopPairingCode(
      { projectId: 'p-payments' },
      ownerContext,
    )

    const exchange = await repository.exchangeDesktopPairingCode({ code: pairing.code })

    expect(exchange).toMatchObject({
      role: 'lead',
      projectMemberships: [
        { projectId: 'p-payments', userId: 'u-erich', role: 'lead' },
      ],
    })
    await expect(repository.resolveDesktopTokenSession(exchange.token)).resolves.toMatchObject({
      tokenRecordId: exchange.tokenId,
      session: {
        role: 'lead',
        projectMemberships: [
          { projectId: 'p-payments', userId: 'u-erich', role: 'lead' },
        ],
      },
    })
  })

  it('rejects a seed desktop token that was never created by pairing exchange', async () => {
    const repository = createSeedTeamRepository()

    await expect(
      repository.resolveDesktopTokenSession('devflow-desktop-token-p-payments'),
    ).resolves.toBeNull()
  })

  it('rejects pairing a seed project from a different organization', async () => {
    const repository = createSeedTeamRepository()

    await expect(repository.createDesktopPairingCode(
      { projectId: 'p-payments' },
      { organizationId: 'org-other', userId: 'u-other-owner' },
    )).rejects.toMatchObject({ name: 'TeamProjectScopeError' })
  })

  it('makes accepted remote sync summaries visible to team overview readers', async () => {
    const repository = createSeedTeamRepository()

    await expect(
      repository.uploadRunSummary({
        kind: 'approval',
        runId: 'run-1',
        version: 1,
        projectId: 'project-1',
        title: 'Approve payment workflow',
        status: 'building',
        currentNodeId: 'node-build',
        currentNode: { id: 'node-build', stage: 'build', kind: 'task', status: 'running' },
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
      repository.uploadTestEvidenceSummary(evidenceSummary, {
        organizationId: 'org-demo',
        userId: 'u-other-member',
      }),
    ).rejects.toThrow('Canonical Run Summary is required before evidence sync')

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

    const overview = await repository.getTeamOverview(syncContext)
    const bundle = await repository.getRunsBundle(syncContext)

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

  it('keeps child summary IDs bound to their original organization, Run, project, and node', async () => {
    const repository = createSeedTeamRepository()
    const victimContext = { organizationId: 'org-demo', userId: 'u-victim' }
    const attackerContext = { organizationId: 'org-demo', userId: 'u-attacker' }
    await repository.uploadRunSummary(
      {
        kind: 'run',
        runId: 'run-victim',
        version: 1,
        projectId: 'project-victim',
        title: 'Victim Run',
        status: 'testing',
        currentNodeId: 'node-test',
        currentNode: { id: 'node-test', stage: 'test', kind: 'test', status: 'running' },
        branchName: 'ai/victim',
        updatedAt: '2026-07-31T12:00:00.000Z',
      },
      victimContext,
    )
    await repository.uploadRunSummary(
      {
        kind: 'run',
        runId: 'run-attacker',
        version: 1,
        projectId: 'project-attacker',
        title: 'Attacker Run',
        status: 'testing',
        currentNodeId: 'node-attacker',
        currentNode: { id: 'node-attacker', stage: 'test', kind: 'test', status: 'running' },
        branchName: 'ai/attacker',
        updatedAt: '2026-07-31T12:00:00.000Z',
      },
      attackerContext,
    )
    const evidence: Parameters<typeof repository.uploadTestEvidenceSummary>[0] = {
      id: 'evidence-victim',
      runId: 'run-victim',
      nodeId: 'node-test',
      projectId: 'project-victim',
      command: 'pnpm test',
      status: 'passed',
      exitCode: 0,
      durationMs: 100,
      summary: 'Victim tests passed.',
      redacted: true,
      createdAt: '2026-07-31T12:01:00.000Z',
    }
    const review: Parameters<typeof repository.uploadAgentReviewSummary>[0] = {
      id: 'review-victim',
      runId: 'run-victim',
      nodeId: 'node-review',
      projectId: 'project-victim',
      runtime: 'electron',
      providerId: 'fake-knowledge-review',
      model: 'fake',
      conclusion: 'Victim review completed.',
      summary: 'Victim finding remains blocking.',
      riskCount: 1,
      missingEvidenceCount: 0,
      policyFindingCount: 1,
      policyFindingCategories: ['security_risk'],
      policyFindings: [
        {
          id: 'finding-victim',
          reviewId: 'review-victim',
          runId: 'run-victim',
          nodeId: 'node-review',
          category: 'security_risk',
          severity: 'high',
          summary: 'Victim authentication boundary is incomplete.',
          createdAt: '2026-07-31T12:01:00.000Z',
        },
      ],
      advisoryLevel: 'block',
      blocksApproval: true,
      confidence: 0.95,
      redacted: true,
      createdAt: '2026-07-31T12:01:00.000Z',
    }
    const coding: Parameters<typeof repository.uploadCodingAgentSummary>[0] = {
      id: 'coding-victim',
      runId: 'run-victim',
      nodeId: 'node-build',
      projectId: 'project-victim',
      requestedBy: 'u-victim',
      providerId: 'fake-coding-engine',
      engine: 'fake',
      status: 'completed',
      branchName: 'devflow/run-victim-node-build',
      summary: 'Victim coding completed.',
      changedPaths: ['src/victim.ts'],
      startedAt: '2026-07-31T12:01:00.000Z',
      completedAt: '2026-07-31T12:02:00.000Z',
      redacted: true,
    }

    await repository.uploadTestEvidenceSummary(evidence, victimContext)
    await repository.uploadAgentReviewSummary(review, victimContext)
    await repository.uploadCodingAgentSummary(coding, victimContext)
    await expect(
      repository.uploadTestEvidenceSummary(
        { ...evidence, summary: 'Victim tests passed again.' },
        victimContext,
      ),
    ).resolves.toMatchObject({ accepted: true })
    await expect(
      repository.uploadAgentReviewSummary(
        { ...review, summary: 'Victim finding remains after retry.' },
        victimContext,
      ),
    ).resolves.toMatchObject({ accepted: true })
    await expect(
      repository.uploadCodingAgentSummary(
        { ...coding, summary: 'Victim coding retry completed.' },
        victimContext,
      ),
    ).resolves.toMatchObject({ accepted: true })

    await expect(
      repository.uploadTestEvidenceSummary(
        { ...evidence, nodeId: 'node-other-test' },
        victimContext,
      ),
    ).rejects.toThrow('conflicts with canonical scope')
    await expect(
      repository.uploadAgentReviewSummary(
        { ...review, nodeId: 'node-other-review' },
        victimContext,
      ),
    ).rejects.toThrow('conflicts with canonical scope')
    await expect(
      repository.uploadCodingAgentSummary(
        { ...coding, nodeId: 'node-other-build' },
        victimContext,
      ),
    ).rejects.toThrow('conflicts with canonical scope')

    await expect(
      repository.uploadTestEvidenceSummary(
        {
          ...evidence,
          runId: 'run-attacker',
          nodeId: 'node-attacker',
          projectId: 'project-attacker',
        },
        attackerContext,
      ),
    ).rejects.toThrow('conflicts with canonical scope')
    await expect(
      repository.uploadAgentReviewSummary(
        {
          ...review,
          runId: 'run-attacker',
          nodeId: 'node-attacker',
          projectId: 'project-attacker',
          policyFindingCount: 0,
          policyFindingCategories: [],
          policyFindings: [],
        },
        attackerContext,
      ),
    ).rejects.toThrow('conflicts with canonical scope')
    await expect(
      repository.uploadCodingAgentSummary(
        {
          ...coding,
          runId: 'run-attacker',
          nodeId: 'node-attacker',
          projectId: 'project-attacker',
        },
        attackerContext,
      ),
    ).rejects.toThrow('conflicts with canonical scope')

    const overview = await repository.getTeamOverview(syncContext)
    expect(overview.testEvidenceSummaries.filter((item) => item.id === evidence.id)).toEqual([
      expect.objectContaining({
        runId: 'run-victim',
        nodeId: 'node-test',
        projectId: 'project-victim',
        summary: 'Victim tests passed again.',
      }),
    ])
    expect(overview.agentReviews.filter((item) => item.id === review.id)).toEqual([
      expect.objectContaining({
        runId: 'run-victim',
        nodeId: 'node-review',
        projectId: 'project-victim',
        policyFindings: [expect.objectContaining({ id: 'finding-victim' })],
      }),
    ])
    expect(overview.codingAgentSummaries.filter((item) => item.id === coding.id)).toEqual([
      expect.objectContaining({
        runId: 'run-victim',
        nodeId: 'node-build',
        projectId: 'project-victim',
        summary: 'Victim coding retry completed.',
      }),
    ])
  })

  it('converges prior active nodes when consecutive summaries advance the canonical Run', async () => {
    const repository = createSeedTeamRepository()
    const summaries = [
      {
        version: 1,
        currentNodeId: 'node-design-gate',
        currentNode: {
          id: 'node-design-gate',
          stage: 'design' as const,
          kind: 'gate' as const,
          status: 'blocked' as const,
          requiredRole: 'lead' as const,
        },
        status: 'paused_at_gate' as const,
        updatedAt: '2026-06-16T00:00:00.000Z',
      },
      {
        version: 2,
        currentNodeId: 'node-build',
        currentNode: {
          id: 'node-build',
          stage: 'build' as const,
          kind: 'task' as const,
          status: 'running' as const,
        },
        status: 'building' as const,
        updatedAt: '2026-06-16T00:01:00.000Z',
      },
      {
        version: 3,
        currentNodeId: 'node-test',
        currentNode: {
          id: 'node-test',
          stage: 'test' as const,
          kind: 'test' as const,
          status: 'running' as const,
        },
        status: 'testing' as const,
        updatedAt: '2026-06-16T00:02:00.000Z',
      },
    ]

    for (const summary of summaries) {
      await repository.uploadRunSummary(
        {
          kind: 'run',
          runId: 'run-consecutive',
          projectId: 'project-1',
          title: 'Consecutive remote Run',
          branchName: 'ai/consecutive-run',
          ...summary,
        },
        syncContext,
      )
    }

    const run = (await repository.getRunsBundle(syncContext)).runs.find(
      (candidate) => candidate.id === 'run-consecutive',
    )
    expect(run?.nodes.map((node) => [node.id, node.status])).toEqual([
      ['node-design-gate', 'success'],
      ['node-build', 'success'],
      ['node-test', 'running'],
    ])
    expect(
      run?.nodes.filter((node) => node.status === 'running' || node.status === 'blocked'),
    ).toEqual([expect.objectContaining({ id: 'node-test' })])
    expect(run?.version).toBe(3)
  })

  it('accepts a higher Run version even when its display timestamp is older', async () => {
    const repository = createSeedTeamRepository()
    const summary = {
      kind: 'run' as const,
      runId: 'run-version-over-time',
      version: 1,
      projectId: 'project-1',
      title: 'Version one',
      status: 'building' as const,
      currentNodeId: 'node-build',
      currentNode: {
        id: 'node-build',
        stage: 'build' as const,
        kind: 'task' as const,
        status: 'running' as const,
      },
      branchName: 'ai/version-over-time',
      updatedAt: '2026-06-16T00:10:00.000Z',
    }
    await repository.uploadRunSummary(summary, syncContext)

    await expect(
      repository.uploadRunSummary(
        {
          ...summary,
          version: 2,
          title: 'Version two is authoritative',
          updatedAt: '2026-06-16T00:09:00.000Z',
        },
        syncContext,
      ),
    ).resolves.toMatchObject({ accepted: true })

    expect(
      (await repository.getRunsBundle(syncContext)).runs.find(
        (run) => run.id === summary.runId,
      ),
    ).toMatchObject({ version: 2, title: 'Version two is authoritative' })
  })

  it('accepts only an identical projection when the Run version is unchanged', async () => {
    const repository = createSeedTeamRepository()
    const summary = {
      kind: 'run' as const,
      runId: 'run-idempotent-version',
      version: 2,
      projectId: 'project-1',
      title: 'Stable versioned projection',
      status: 'testing' as const,
      currentNodeId: 'node-test',
      currentNode: {
        id: 'node-test',
        stage: 'test' as const,
        kind: 'test' as const,
        status: 'running' as const,
      },
      branchName: 'ai/idempotent-version',
      updatedAt: '2026-06-16T00:10:00.000Z',
    }
    await repository.uploadRunSummary(summary, syncContext)

    await expect(repository.uploadRunSummary(summary, syncContext)).resolves.toMatchObject({
      accepted: true,
    })
    await expect(
      repository.uploadRunSummary(
        { ...summary, title: 'Conflicting content at the same version' },
        syncContext,
      ),
    ).rejects.toThrow('Remote Run Summary conflicts with canonical ownership or is stale')

    expect(
      (await repository.getRunsBundle(syncContext)).runs.find(
        (run) => run.id === summary.runId,
      ),
    ).toMatchObject({ version: 2, title: summary.title })
  })

  it('rejects seed, cross-project, and stale run-summary collisions', async () => {
    const repository = createSeedTeamRepository()
    const canonical = {
      kind: 'run' as const,
      runId: 'run-owned',
      version: 2,
      projectId: 'project-1',
      title: 'Owned Run',
      status: 'building' as const,
      currentNodeId: 'node-build',
      currentNode: {
        id: 'node-build',
        stage: 'build' as const,
        kind: 'task' as const,
        status: 'running' as const,
      },
      branchName: 'ai/owned-run',
      updatedAt: '2026-06-16T00:10:00.000Z',
    }

    await expect(repository.uploadRunSummary(canonical, syncContext)).resolves.toMatchObject({
      accepted: true,
    })
    await expect(
      repository.uploadRunSummary(
        {
          ...canonical,
          version: 3,
          projectId: 'project-2',
          updatedAt: '2026-06-16T00:11:00.000Z',
        },
        syncContext,
      ),
    ).rejects.toThrow('Remote Run Summary conflicts with canonical ownership or is stale')
    await expect(
      repository.uploadRunSummary(
        {
          ...canonical,
          version: 3,
          title: 'Cross-user overwrite',
          updatedAt: '2026-06-16T00:12:00.000Z',
        },
        { organizationId: 'org-demo', userId: 'u-other-member' },
      ),
    ).rejects.toThrow('Remote Run Summary conflicts with canonical ownership or is stale')
    await expect(
      repository.uploadRunSummary(
        {
          ...canonical,
          version: 1,
          title: 'Stale Run',
          updatedAt: '2026-06-16T00:20:00.000Z',
        },
        syncContext,
      ),
    ).rejects.toThrow('Remote Run Summary conflicts with canonical ownership or is stale')
    await expect(
      repository.uploadRunSummary(
        {
          ...canonical,
          version: 3,
          runId: 'run-health-001',
          projectId: 'p-payments',
          updatedAt: '2026-06-16T00:11:00.000Z',
        },
        syncContext,
      ),
    ).rejects.toThrow('Remote Run Summary conflicts with canonical ownership or is stale')

    const storedRun = (await repository.getRunsBundle(syncContext)).runs.find(
      (run) => run.id === canonical.runId,
    )
    expect(storedRun).toMatchObject({
      version: canonical.version,
      title: canonical.title,
      creatorId: syncContext.userId,
      nodes: [expect.objectContaining({ ownerId: syncContext.userId })],
    })
  })
})
