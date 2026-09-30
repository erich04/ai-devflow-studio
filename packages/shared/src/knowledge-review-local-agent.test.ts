import { describe, expect, it } from 'vitest'
import { AgentProviderRequestError, buildAgentReviewContext, createKnowledgeReviewPrompt, runKnowledgeReviewAgent, type AgentProvider } from './agent-review'
import { artifacts, knowledgeChunks, knowledgeDocuments, runs } from './fixtures'
import {
  createLocalAgentKnowledgeReviewPrompt,
  readLocalAgentKnowledgeReviewOutput,
} from './knowledge-review-local-agent'

const digest = 'a'.repeat(64)
const review = {
  conclusion: '方案可以进入评审。',
  summary: '健康端点的状态映射已写明。',
  risks: [],
  missingEvidence: [],
  missingEvidenceDetails: [],
  suggestedTests: ['补一条缓存超时的测试。'],
  confidence: 0.8,
}
const findings = {
  version: 1,
  repositoryDigest: digest,
  verifiedFacts: [{ id: 'fact-1', statement: '路由只组合服务结果。', citationIds: ['citation-1'] }],
  citations: [{ id: 'citation-1', path: 'src/routes/health.ts', contentDigest: digest, lineStart: 1, lineEnd: 12 }],
  assumptions: [],
  openQuestions: [],
  uncheckedScopes: ['部署脚本'],
}
const usage = { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 0 }

function expectProviderError(action: () => unknown, sanitizedCause: string) {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(AgentProviderRequestError)
    expect(error).toMatchObject({ code: 'invalid_model_output', sanitizedCause, billingState: 'confirmed', usage })
    return
  }
  throw new Error('expected a provider error')
}

describe('local Agent Gate Review (knowledge-context K2)', () => {
  it('wraps the direct review prompt with read-only repository instructions', () => {
    const prompt = createLocalAgentKnowledgeReviewPrompt('REVIEW_PROMPT_BODY', { knowledgeRoot: 'docs/knowledge' })

    expect(prompt.endsWith('REVIEW_PROMPT_BODY')).toBe(true)
    expect(prompt).toContain('Use only the read, glob, grep and list tools')
    expect(prompt).toContain('Project knowledge lives in docs/knowledge.')
    expect(prompt).toContain('they are not Gate evidence and never satisfy or approve the Gate')
    expect(createLocalAgentKnowledgeReviewPrompt('x', { knowledgeRoot: '' })).toContain('Project knowledge lives in the repository.')
  })

  it('accepts the direct review schema with and without repository findings', () => {
    expect(readLocalAgentKnowledgeReviewOutput(review, { model: 'm', usage, toolCalls: 0 })).toEqual({
      model: 'm', conclusion: review.conclusion, summary: review.summary, risks: [], missingEvidence: [],
      missingEvidenceDetails: [], suggestedTests: review.suggestedTests, confidence: 0.8, usage,
    })
    const withFindings = readLocalAgentKnowledgeReviewOutput({ ...review, repositoryFindings: findings }, { model: 'm', usage, toolCalls: 5 })
    expect(withFindings.repositoryFindings).toEqual(findings)
    // An empty findings object means the review did not need the repository.
    const empty = { ...findings, verifiedFacts: [], citations: [] }
    expect(readLocalAgentKnowledgeReviewOutput({ ...review, repositoryFindings: empty }, { model: 'm', usage, toolCalls: 1 }).repositoryFindings).toBeUndefined()
    // Model-authored identity is ignored.
    expect(readLocalAgentKnowledgeReviewOutput({ ...review, model: 'forged' }, { model: 'm', toolCalls: 0 }).model).toBe('m')
  })

  it('rejects an invalid review, invalid findings and exceeded bounds', () => {
    expectProviderError(() => readLocalAgentKnowledgeReviewOutput({ ...review, confidence: '80%' }, { model: 'm', usage, toolCalls: 0 }), 'invalid_review_schema')
    expectProviderError(() => readLocalAgentKnowledgeReviewOutput({
      ...review,
      repositoryFindings: { ...findings, verifiedFacts: [{ id: 'fact-1', statement: 'x', citationIds: ['citation-9'] }] },
    }, { model: 'm', usage, toolCalls: 1 }), 'local_agent_invalid_findings')
    expectProviderError(() => readLocalAgentKnowledgeReviewOutput({
      ...review,
      repositoryFindings: { ...findings, citations: [{ ...findings.citations[0], path: '../outside.ts' }] },
    }, { model: 'm', usage, toolCalls: 1 }), 'local_agent_invalid_findings')
    expectProviderError(() => readLocalAgentKnowledgeReviewOutput({ ...review, repositoryFindings: 'checked' }, { model: 'm', usage, toolCalls: 1 }), 'local_agent_invalid_findings')
    expectProviderError(() => readLocalAgentKnowledgeReviewOutput(review, { model: 'm', usage, toolCalls: 65 }), 'local_agent_tool_limit')
  })

  it('records the executor kind and repository findings only for a local Agent review', async () => {
    const run = runs[0]!
    const node = run.nodes.find((item) => item.id === 'n-design-gate')!
    const context = await buildAgentReviewContext({ run, node, artifacts, testEvidence: [], knowledgeDocuments, knowledgeChunks })
    const request = { id: 'local-review', runId: run.id, nodeId: node.id, projectId: run.projectId, requestedBy: 'u-ling', runtime: 'electron' as const }
    let receivedPrompt = ''
    const provider = (executorKind?: 'local-agent'): AgentProvider => ({
      id: 'saved-provider', name: 'OpenCode（可读仓库）· Saved', model: 'saved-model',
      ...(executorKind ? { executorKind } : {}),
      reviewKnowledge: async (input) => {
        receivedPrompt = input.prompt
        return { ...readLocalAgentKnowledgeReviewOutput({ ...review, repositoryFindings: findings }, { model: 'saved-model', usage, toolCalls: 3 }) }
      },
    })

    const local = await runKnowledgeReviewAgent({ request, context, provider: provider('local-agent'), now: () => '2026-09-30T00:00:00.000Z' })
    expect(receivedPrompt).toBe(createKnowledgeReviewPrompt(context))
    expect(local.review).toMatchObject({ executorKind: 'local-agent', repositoryFindings: findings, gateAdvisory: { blocksApproval: false } })
    expect(local.tokenUsage.executorKind).toBe('local-agent')
    expect(local.trace.steps[2]).toMatchObject({
      label: 'Run OpenCode（可读仓库）· Saved (read-only repository access)',
      summary: expect.stringContaining('1 repository citation(s) verified against local bytes'),
    })

    // A direct model call cannot contribute repository facts, even if its output carries them.
    const direct = await runKnowledgeReviewAgent({ request, context, provider: provider(), now: () => '2026-09-30T00:00:00.000Z' })
    expect(direct.review.executorKind).toBeUndefined()
    expect(direct.review.repositoryFindings).toBeUndefined()
    expect(direct.tokenUsage.executorKind).toBe('direct-provider')
  })
})
