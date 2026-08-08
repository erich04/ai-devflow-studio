import { describe, expect, it } from 'vitest'
import {
  createRemoteAgentReviewSummary,
  createWarnOnlyDefaultPolicy,
  type AgentReviewResult,
  type TeamSession,
} from '@ai-devflow/shared'
import { createSeedTeamRepository } from '../repositories/team-repository'
import { resolveTeamRoute } from './team-routes'

const runCreatorSession: TeamSession = {
  source: 'authenticated',
  organizationId: 'org-demo',
  userId: 'u-wang',
  role: 'member',
  authAccountId: 'acct-wang',
  projectMemberships: [{ projectId: 'p-payments', userId: 'u-wang', role: 'member' }],
}

const independentProjectLeadSession: TeamSession = {
  source: 'authenticated',
  organizationId: 'org-demo',
  userId: 'u-reviewer',
  role: 'lead',
  authAccountId: 'acct-reviewer',
  projectMemberships: [{ projectId: 'p-payments', userId: 'u-reviewer', role: 'lead' }],
}

const review: AgentReviewResult = {
  id: 'review-security-policy',
  requestId: 'request-security-policy',
  runId: 'run-health-001',
  nodeId: 'n-design-gate',
  projectId: 'p-payments',
  runtime: 'electron',
  providerId: 'fake-knowledge-review',
  model: 'fake',
  conclusion: 'Security finding requires review.',
  summary: 'The design exposes a security risk.',
  risks: ['Authentication boundary is incomplete.'],
  missingEvidence: [],
  suggestedTests: [],
  knowledgeReferences: [],
  policyFindings: [
    {
      id: 'finding-security-policy',
      reviewId: 'review-security-policy',
      runId: 'run-health-001',
      nodeId: 'n-design-gate',
      category: 'security_risk',
      severity: 'high',
      summary: 'Authentication boundary is incomplete.',
      evidenceIds: ['art-design'],
      knowledgeReferenceIds: [],
      createdAt: '2026-07-31T12:00:00.000Z',
    },
  ],
  confidence: 0.95,
  gateAdvisory: {
    id: 'advisory-security-policy',
    runId: 'run-health-001',
    nodeId: 'n-design-gate',
    level: 'block',
    blocksApproval: true,
    summary: 'Security finding requires review.',
    missingEvidence: [],
    riskCount: 1,
    createdAt: '2026-07-31T12:00:00.000Z',
  },
  createdAt: '2026-07-31T12:00:00.000Z',
}

describe('remote agent-review enforcement', () => {
  it('preserves policy findings so the API accepts an override with the local blocker set', async () => {
    const repository = createSeedTeamRepository()
    const basePolicy = createWarnOnlyDefaultPolicy({
      organizationId: 'org-demo',
      updatedAt: '2026-07-31T12:00:00.000Z',
    })
    const policy = {
      ...basePolicy,
      version: 7,
      rules: basePolicy.rules.map((rule) =>
        rule.ruleKey === 'agent_finding:security_risk:high'
          ? { ...rule, defaultAction: 'block' as const }
          : rule,
      ),
    }
    await repository.saveEnforcementPolicy(policy, independentProjectLeadSession)

    const syncResult = await resolveTeamRoute(
      'POST',
      '/api/sync/agent-review-summary',
      repository,
      {
        body: createRemoteAgentReviewSummary(review),
        session: runCreatorSession,
      },
    )
    expect(syncResult).toMatchObject({ status: 202 })

    const blockerId = 'agent_finding:security_risk:high:finding-security-policy'
    const overrideResult = await resolveTeamRoute(
      'POST',
      '/api/gates/override',
      repository,
      {
        body: {
          runId: 'run-health-001',
          nodeId: 'n-design-gate',
          projectId: 'p-payments',
          reason: 'Reviewed the synced security finding.',
          blockedReasonIds: [blockerId],
          policyVersion: policy.version,
        },
        session: independentProjectLeadSession,
      },
    )

    expect(overrideResult).toMatchObject({
      status: 201,
      body: {
        blockedReasonIds: [blockerId],
        status: 'accepted',
      },
    })
  })

  it('rejects a positive policy finding count when the finding details are absent', async () => {
    const repository = createSeedTeamRepository()
    const result = await resolveTeamRoute(
      'POST',
      '/api/sync/agent-review-summary',
      repository,
      {
        body: {
          id: 'review-incomplete-policy-findings',
          runId: 'run-health-001',
          nodeId: 'n-design-gate',
          projectId: 'p-payments',
          runtime: 'electron',
          providerId: 'fake-knowledge-review',
          model: 'fake',
          conclusion: 'Security finding requires review.',
          summary: 'The details were omitted.',
          riskCount: 1,
          missingEvidenceCount: 0,
          policyFindingCount: 1,
          policyFindingCategories: ['security_risk'],
          advisoryLevel: 'block',
          blocksApproval: true,
          confidence: 0.95,
          redacted: true,
          createdAt: '2026-07-31T12:00:00.000Z',
        },
        session: runCreatorSession,
      },
    )

    expect(result).toEqual({
      status: 400,
      body: {
        error: 'bad_request',
        message: 'Invalid remote agent review summary payload',
      },
    })
  })

  it('sanitizes direct policy finding details before they become team-visible', async () => {
    const repository = createSeedTeamRepository()
    const result = await resolveTeamRoute(
      'POST',
      '/api/sync/agent-review-summary',
      repository,
      {
        body: {
          id: 'review-hostile-policy-finding',
          runId: 'run-health-001',
          nodeId: 'n-design-gate',
          projectId: 'p-payments',
          runtime: 'electron',
          providerId: 'fake-knowledge-review',
          model: 'fake',
          conclusion: 'Security review from /Users/Alice/private/repo.',
          summary: 'API_TOKEN=review-secret',
          riskCount: 1,
          missingEvidenceCount: 0,
          policyFindingCount: 1,
          policyFindingCategories: ['security_risk'],
          policyFindings: [
            {
              id: 'finding-hostile-policy',
              reviewId: 'review-hostile-policy-finding',
              runId: 'run-health-001',
              nodeId: 'n-design-gate',
              category: 'security_risk',
              severity: 'high',
              summary: 'Found in C:\\Users\\Alice\\repo API_TOKEN=finding-secret',
              createdAt: '2026-07-31T12:00:00.000Z',
              evidenceIds: ['local-evidence-id'],
            },
          ],
          advisoryLevel: 'block',
          blocksApproval: true,
          confidence: 0.95,
          redacted: true,
          createdAt: '2026-07-31T12:00:00.000Z',
        },
        session: runCreatorSession,
      },
    )

    expect(result).toMatchObject({ status: 202 })
    const overview = await repository.getTeamOverview(runCreatorSession)
    const stored = overview.agentReviews.find(
      (candidate) => candidate.id === 'review-hostile-policy-finding',
    )
    expect(JSON.stringify(stored)).not.toContain('/Users/Alice')
    expect(JSON.stringify(stored)).not.toMatch(/C:[\\/]Users[\\/]Alice/)
    expect(JSON.stringify(stored)).not.toContain('review-secret')
    expect(JSON.stringify(stored)).not.toContain('finding-secret')
    expect(JSON.stringify(stored)).not.toContain('local-evidence-id')
  })
})
