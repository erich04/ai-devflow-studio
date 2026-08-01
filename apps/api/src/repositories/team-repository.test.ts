import { describe, expect, it } from 'vitest'
import { createSeedTeamRepository } from './team-repository'

describe('seed team repository', () => {
  const syncContext = { organizationId: 'org-demo', userId: 'u-erich' }

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
      userId: 'u-ling',
      role: 'lead',
      projectMemberships: [{ projectId: 'p-payments', userId: 'u-ling', role: 'lead' }],
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
        { projectId: 'p-payments', userId: 'u-erich', role: 'owner' },
      ],
    })
    await expect(repository.resolveDesktopTokenSession(exchange.token)).resolves.toMatchObject({
      role: 'lead',
      projectMemberships: [
        { projectId: 'p-payments', userId: 'u-erich', role: 'owner' },
      ],
    })
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
  })

  it('rejects seed, cross-project, and stale run-summary collisions', async () => {
    const repository = createSeedTeamRepository()
    const canonical = {
      kind: 'run' as const,
      runId: 'run-owned',
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
          title: 'Stale Run',
          updatedAt: '2026-06-16T00:09:00.000Z',
        },
        syncContext,
      ),
    ).rejects.toThrow('Remote Run Summary conflicts with canonical ownership or is stale')
    await expect(
      repository.uploadRunSummary(
        {
          ...canonical,
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
      title: canonical.title,
      creatorId: syncContext.userId,
      nodes: [expect.objectContaining({ ownerId: syncContext.userId })],
    })
  })
})
