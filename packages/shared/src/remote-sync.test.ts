import { describe, expect, it } from 'vitest'
import type { AgentReviewResult, TestEvidence, WorkflowRun } from './domain'
import {
  createAuthenticatedTeamSessionHeaders,
  createDemoTeamSessionHeaders,
  createRemoteAgentReviewSummary,
  createRemoteTestEvidenceSummary,
  createRemoteRunSummary,
  parseRemoteAgentReviewSummary,
  parseRemoteRunSummary,
  parseRemoteTestEvidenceSummary,
  redactRemoteTestEvidenceSummaryForSync,
  resolveTeamProjectId,
} from './remote-sync'

const run: WorkflowRun = {
  id: 'run-1',
  version: 4,
  title: 'Remote sync run',
  request: 'Sync only approved summaries.',
  projectId: 'project-1',
  creatorId: 'user-1',
  status: 'building',
  currentNodeId: 'node-gate',
  branchName: 'ai/remote-sync',
  createdAt: '2026-06-16T00:00:00.000Z',
  updatedAt: '2026-06-16T00:10:00.000Z',
  nodes: [{
    id: 'node-gate',
    stage: 'design',
    title: 'Design Gate',
    subtitle: 'Review the design.',
    kind: 'gate',
    status: 'blocked',
    ownerId: 'user-1',
    requiredRole: 'lead',
    retryCount: 0,
    artifactIds: [],
  }],
  edges: [],
}

const evidence: TestEvidence = {
  id: 'evidence-1',
  runId: 'run-1',
  nodeId: 'node-test',
  projectId: 'project-1',
  command: 'pnpm test',
  cwd: 'C:\\Users\\erich\\repo',
  status: 'passed',
  exitCode: 0,
  durationMs: 1200,
  stdout: 'SECRET_TOKEN=sk-123',
  stderr: 'stack trace that should stay local',
  summary: 'Tests passed in 1200ms',
  redacted: true,
  createdAt: '2026-06-16T00:12:00.000Z',
}

describe('remote sync helpers', () => {
  it('resolves the paired team project for the bound local project', () => {
    expect(resolveTeamProjectId({
      localProjectId: 'local-project-1',
      credential: {
        tokenId: 'desktop-token-1',
        organizationId: 'org-demo',
        projectId: 'p-payments',
        localProjectId: 'local-project-1',
        userId: 'u-ling',
        role: 'lead',
        authAccountId: 'acct-ling',
        projectMemberships: [
          { projectId: 'p-payments', userId: 'u-ling', role: 'lead' },
        ],
        createdAt: '2026-06-20T00:00:00.000Z',
      },
    })).toBe('p-payments')
  })

  it('rejects team project resolution without pairing metadata', () => {
    expect(() =>
      resolveTeamProjectId({
        localProjectId: 'local-project-1',
        credential: null,
      }),
    ).toThrow(/Pair Team Project/)
  })

  it('rejects legacy pairing metadata that has no local project binding', () => {
    expect(() =>
      resolveTeamProjectId({
        localProjectId: 'local-project-1',
        credential: {
          tokenId: 'desktop-token-legacy',
          organizationId: 'org-demo',
          projectId: 'p-payments',
          userId: 'u-ling',
          role: 'lead',
          authAccountId: 'acct-ling',
          projectMemberships: [
            { projectId: 'p-payments', userId: 'u-ling', role: 'lead' },
          ],
          createdAt: '2026-06-20T00:00:00.000Z',
        },
      }),
    ).toThrow(/not bound/)
  })

  it('rejects a local project that is not the active pairing binding', () => {
    expect(() =>
      resolveTeamProjectId({
        localProjectId: 'local-project-2',
        credential: {
          tokenId: 'desktop-token-1',
          organizationId: 'org-demo',
          projectId: 'p-payments',
          localProjectId: 'local-project-1',
          userId: 'u-ling',
          role: 'lead',
          authAccountId: 'acct-ling',
          projectMemberships: [
            { projectId: 'p-payments', userId: 'u-ling', role: 'lead' },
          ],
          createdAt: '2026-06-20T00:00:00.000Z',
        },
      }),
    ).toThrow(/different local project/)
  })

  it('creates explicit demo team session headers for API clients', () => {
    expect(createDemoTeamSessionHeaders()).toEqual({
      'x-devflow-session-source': 'demo',
      'x-devflow-organization-id': 'org-demo',
      'x-devflow-user-id': 'u-erich',
      'x-devflow-user-role': 'owner',
      'x-devflow-project-roles': 'p-payments:owner,p-admin:owner',
    })
  })

  it('creates authenticated team session headers for paired clients', () => {
    expect(createAuthenticatedTeamSessionHeaders({
      organizationId: 'org-demo',
      userId: 'u-github-1',
      role: 'lead',
      authAccountId: 'acct-github-1',
      projectRoles: [
        { projectId: 'p-payments', role: 'lead' },
        { projectId: 'p-admin', role: 'member' },
      ],
    })).toEqual({
      'x-devflow-session-source': 'authenticated',
      'x-devflow-organization-id': 'org-demo',
      'x-devflow-user-id': 'u-github-1',
      'x-devflow-user-role': 'lead',
      'x-devflow-auth-account-id': 'acct-github-1',
      'x-devflow-project-roles': 'p-payments:lead,p-admin:member',
    })
  })

  it('creates a remote run summary without local-only execution details', () => {
    const summary = createRemoteRunSummary(run, 'approval')
    expect(summary).toEqual({
      kind: 'approval',
      runId: 'run-1',
      version: 4,
      projectId: 'project-1',
      title: 'Remote sync run',
      status: 'building',
      currentNodeId: 'node-gate',
      currentNode: {
        id: 'node-gate',
        stage: 'design',
        kind: 'gate',
        status: 'blocked',
        requiredRole: 'lead',
      },
      branchName: 'ai/remote-sync',
      updatedAt: '2026-06-16T00:10:00.000Z',
    })
    expect(parseRemoteRunSummary(summary)).toEqual(summary)
    expect(() => parseRemoteRunSummary({
      ...summary,
      currentNode: { ...summary.currentNode, requiredRole: 'viewer' },
    })).toThrow('Invalid remote run summary payload')
  })

  it('rejects local node IDs that impersonate the Team storage namespace', () => {
    expect(() =>
      createRemoteRunSummary({
        ...run,
        currentNodeId: 'run-1:node-gate',
        nodes: run.nodes.map((node) => ({
          ...node,
          id: 'run-1:node-gate',
        })),
      }),
    ).toThrow(/reserved Team node namespace/)

    expect(() =>
      createRemoteTestEvidenceSummary({
        ...evidence,
        nodeId: 'run-1:node-test',
      }),
    ).toThrow(/reserved Team node namespace/)
  })

  it('redacts paths and secrets from outbound Run title and branch name', () => {
    const summary = createRemoteRunSummary({
      ...run,
      title: 'Build from C:\\Users\\Alice\\private\\repo API_TOKEN=title-secret',
      branchName: 'C:\\Users\\Alice\\private\\branch API_TOKEN=branch-secret',
    })

    expect(summary.title).toBe(
      'Build from [REDACTED:local_absolute_path] [REDACTED:env_secret_assignment]',
    )
    expect(summary.branchName).toBe(
      '[REDACTED:local_absolute_path] [REDACTED:env_secret_assignment]',
    )
    expect(JSON.stringify(summary)).not.toContain('title-secret')
    expect(JSON.stringify(summary)).not.toContain('branch-secret')
    expect(JSON.stringify(summary)).not.toMatch(/C:[\\/]Users[\\/]Alice/)
  })

  it('creates redacted remote test evidence summaries and omits raw stdout, stderr, and cwd', () => {
    const summary = createRemoteTestEvidenceSummary(evidence)

    expect(summary).toEqual({
      id: 'evidence-1',
      runId: 'run-1',
      nodeId: 'node-test',
      projectId: 'project-1',
      command: 'pnpm test',
      status: 'passed',
      exitCode: 0,
      durationMs: 1200,
      summary: 'Tests passed in 1200ms',
      redacted: true,
      createdAt: '2026-06-16T00:12:00.000Z',
    })
    expect(JSON.stringify(summary)).not.toContain('SECRET_TOKEN')
    expect(JSON.stringify(summary)).not.toContain('stack trace')
    expect(JSON.stringify(summary)).not.toContain('C:\\Users\\erich')
    expect(parseRemoteTestEvidenceSummary(summary)).toEqual(summary)
    expect(() => parseRemoteTestEvidenceSummary({
      ...summary,
      cwd: '/Users/alice/private',
    })).toThrow('Remote test evidence summary contains local-only fields')
  })

  it('redacts paths and secrets embedded in otherwise allowed remote evidence fields', () => {
    const summary = redactRemoteTestEvidenceSummaryForSync({
      id: 'evidence-hostile-fields',
      runId: 'run-1',
      nodeId: 'node-test',
      projectId: 'project-1',
      command: 'node C:\\Users\\Alice\\repo\\test.js API_TOKEN=command-secret',
      status: 'failed',
      exitCode: 1,
      durationMs: 10,
      summary: 'failed at file:///C:/Users/Alice/repo/test.js GH_TOKEN=summary-secret',
      redacted: false,
      createdAt: '2026-06-16T00:12:00.000Z',
      rawOutput: '/Users/Alice/repo API_TOKEN=unknown-field-secret',
    } as Parameters<typeof redactRemoteTestEvidenceSummaryForSync>[0])

    expect(summary.redacted).toBe(true)
    expect(JSON.stringify(summary)).not.toMatch(/C:[\\/]Users[\\/]Alice/)
    expect(JSON.stringify(summary)).not.toContain('command-secret')
    expect(JSON.stringify(summary)).not.toContain('summary-secret')
    expect(summary).not.toHaveProperty('rawOutput')
  })

  it('redacts remote policy finding summaries and omits local evidence references', () => {
    const review: AgentReviewResult = {
      id: 'review-security',
      requestId: 'request-security',
      runId: 'run-1',
      nodeId: 'node-gate',
      projectId: 'project-1',
      runtime: 'electron',
      providerId: 'fake-knowledge-review',
      model: 'fake',
      conclusion: 'Security review completed.',
      summary: 'One security finding.',
      risks: [],
      missingEvidence: [],
      suggestedTests: [],
      knowledgeReferences: [],
      policyFindings: [
        {
          id: 'finding-security',
          reviewId: 'review-security',
          runId: 'run-1',
          nodeId: 'node-gate',
          category: 'security_risk',
          severity: 'high',
          summary: 'Found at C:\\Users\\Alice\\repo\\auth.ts API_TOKEN=finding-secret',
          evidenceIds: ['local-evidence-id'],
          knowledgeReferenceIds: ['local-knowledge-reference-id'],
          createdAt: '2026-07-31T12:00:00.000Z',
        },
      ],
      confidence: 0.9,
      gateAdvisory: {
        id: 'advisory-security',
        runId: 'run-1',
        nodeId: 'node-gate',
        level: 'block',
        blocksApproval: true,
        summary: 'Security review completed.',
        missingEvidence: [],
        riskCount: 1,
        createdAt: '2026-07-31T12:00:00.000Z',
      },
      createdAt: '2026-07-31T12:00:00.000Z',
    }

    const summary = createRemoteAgentReviewSummary(review)

    expect(summary.policyFindings).toEqual([
      {
        id: 'finding-security',
        reviewId: 'review-security',
        runId: 'run-1',
        nodeId: 'node-gate',
        category: 'security_risk',
        severity: 'high',
        summary: 'Found at [REDACTED:local_absolute_path] [REDACTED:env_secret_assignment]',
        createdAt: '2026-07-31T12:00:00.000Z',
      },
    ])
    expect(JSON.stringify(summary)).not.toContain('finding-secret')
    expect(JSON.stringify(summary)).not.toContain('local-evidence-id')
    expect(JSON.stringify(summary)).not.toContain('local-knowledge-reference-id')
    expect(parseRemoteAgentReviewSummary(summary)).toEqual(summary)
    expect(() => parseRemoteAgentReviewSummary({
      ...summary,
      policyFindings: summary.policyFindings?.map((finding) => ({
        ...finding,
        runId: 'run-other',
      })),
    })).toThrow('Invalid remote agent review summary payload')
    expect(() =>
      createRemoteAgentReviewSummary({
        ...review,
        nodeId: 'run-1:node-gate',
        policyFindings: review.policyFindings.map((finding) => ({
          ...finding,
          nodeId: 'run-1:node-gate',
        })),
        gateAdvisory: {
          ...review.gateAdvisory,
          nodeId: 'run-1:node-gate',
        },
      }),
    ).toThrow(/reserved Team node namespace/)
  })
})
