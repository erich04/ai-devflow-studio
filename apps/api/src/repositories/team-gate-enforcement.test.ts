import { describe, expect, it } from 'vitest'
import { buildAgentReviewContext, createFakeAgentProvider, runKnowledgeReviewAgent, type GateReviewSubjectSnapshot, type TeamSession } from '@ai-devflow/shared'
import { runs, artifacts } from '@ai-devflow/shared/fixtures'
import { createSeedTeamRepository } from './team-repository'
import { evaluateTeamGateEnforcement } from './team-gate-enforcement'

describe('Team Gate Review subject projection', () => {
  it.each(['current', 'missing', 'request', 'artifact', 'version', 'node', 'sanitizer', 'review-self-report'])('validates metadata-only local Review freshness: %s', async (scenario) => {
    const local = runs[0]!
    const node = local.nodes.find((candidate) => candidate.id === 'n-design-gate')!
    const context = await buildAgentReviewContext({
      run: local, node, artifacts, testEvidence: [], knowledgeDocuments: [], knowledgeChunks: [],
    })
    const { review } = await runKnowledgeReviewAgent({
      request: { id: 'review-projection', runId: local.id, nodeId: node.id,
        projectId: local.projectId, requestedBy: 'u-ling', runtime: 'electron' },
      context, provider: createFakeAgentProvider(),
    })
    const subject: GateReviewSubjectSnapshot = {
      version: 1, runId: local.id, runVersion: local.version, nodeId: node.id,
      stage: node.stage, sanitizerVersion: context.manifest.runRequest.sanitizerVersion,
      requestDigest: context.manifest.runRequest.contentDigest,
      artifacts: context.manifest.subjectArtifacts.map(({ id, nodeId, kind, updatedAt, contentDigest }) =>
        ({ id, nodeId, kind, updatedAt, contentDigest })).sort((a, b) => a.id.localeCompare(b.id)),
    }
    if (scenario === 'request') subject.requestDigest = '0'.repeat(64)
    if (scenario === 'artifact') subject.artifacts[0]!.contentDigest = '0'.repeat(64)
    if (scenario === 'version') subject.runVersion += 1
    if (scenario === 'node') subject.nodeId = 'another-node'
    if (scenario === 'sanitizer') subject.sanitizerVersion = 'sensitive-text-v2'
    if (scenario === 'review-self-report') review.contextManifest!.runRequest.contentDigest = '0'.repeat(64)
    const remote = { ...local, currentNodeId: node.id, request: 'Synced from DevFlow Electron.',
      ...(scenario === 'missing' ? {} : { gateReviewSubject: subject }) }
    const session: TeamSession = { source: 'authenticated', authAccountId: 'acct-u-ling',
      organizationId: 'org-demo', userId: 'u-ling', role: 'lead',
      projectMemberships: [{ projectId: local.projectId, userId: 'u-ling', role: 'lead' }] }
    const repository = createSeedTeamRepository()
    const overview = await repository.getTeamOverview(session)
    const policy = await repository.getEnforcementPolicy(local.projectId, session)
    policy.effectivePolicy.rules = policy.effectivePolicy.rules.map((rule) => ({
      ...rule, action: rule.target === 'missing_agent_review' ? 'block' : 'warn',
    }))
    const result = await evaluateTeamGateEnforcement({
      ...repository,
      getRunsBundle: async () => ({ runs: [remote], artifacts: [], events: [] }),
      getTeamOverview: async () => ({ ...overview, agentReviews: [review] }),
      getEnforcementPolicy: async () => policy,
    }, session, { runId: local.id, projectId: local.projectId, nodeId: node.id })
    expect(result.decision.blocksApproval).toBe(scenario !== 'current')
    if (scenario !== 'current') expect(result.decision).toMatchObject({ status: 'hard_blocked', canOverride: false })
    expect(JSON.stringify(subject)).not.toContain(local.request)
    expect(JSON.stringify(subject)).not.toContain('content":')
  })
})
