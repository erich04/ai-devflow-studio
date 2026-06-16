import { describe, expect, it } from 'vitest'
import {
  artifacts,
  knowledgeChunks,
  knowledgeDocuments,
  runs,
} from './fixtures'
import {
  buildAgentReviewContext,
  createAgentReviewArtifacts,
  createFakeAgentProvider,
  estimateAgentTokenUsage,
  runKnowledgeReviewAgent,
} from './agent-review'
import type { TestEvidence } from './domain'

const run = runs[0]!
const node = run.nodes.find((item) => item.id === 'n-design-gate')!

const evidence: TestEvidence = {
  id: 'evidence-secret',
  runId: run.id,
  nodeId: 'n-test',
  projectId: run.projectId,
  command: 'pnpm test -- --run',
  cwd: '/Users/erich/private/payments-api',
  status: 'passed',
  exitCode: 0,
  durationMs: 900,
  stdout: 'OPENAI_API_KEY=sk-secret smoke passed',
  stderr: 'stderr secret should not leave local machine',
  summary: 'Tests passed in 900ms with token sk-secret',
  redacted: false,
  createdAt: '2026-06-16T12:00:00.000Z',
}

describe('buildAgentReviewContext', () => {
  it('builds a minimal redacted review context without local-only evidence fields', () => {
    const context = buildAgentReviewContext({
      run,
      node,
      artifacts,
      testEvidence: [evidence],
      knowledgeDocuments,
      knowledgeChunks,
    })
    const serialized = JSON.stringify(context)

    expect(context.run.title).toBe(run.title)
    expect(context.node.id).toBe(node.id)
    expect(context.testEvidence[0]).toMatchObject({
      id: evidence.id,
      command: evidence.command,
      status: 'passed',
      summary: expect.stringContaining('REDACTED'),
    })
    expect(serialized).not.toContain(evidence.cwd)
    expect(serialized).not.toContain(evidence.stdout)
    expect(serialized).not.toContain(evidence.stderr)
    expect(serialized).not.toContain('sk-secret')
    expect(context.knowledgeReferences.length).toBeGreaterThan(0)
  })
})

describe('runKnowledgeReviewAgent', () => {
  it('returns deterministic structured review output with trace and provider usage', async () => {
    const context = buildAgentReviewContext({
      run,
      node,
      artifacts,
      testEvidence: [evidence],
      knowledgeDocuments,
      knowledgeChunks,
    })
    const result = await runKnowledgeReviewAgent({
      request: {
        id: 'review-request-1',
        runId: run.id,
        nodeId: node.id,
        projectId: run.projectId,
        requestedBy: 'u-ling',
        runtime: 'electron',
      },
      context,
      provider: createFakeAgentProvider(),
      now: () => '2026-06-16T12:01:00.000Z',
    })

    expect(result.review).toMatchObject({
      conclusion: expect.stringContaining('Knowledge Review'),
      confidence: expect.any(Number),
      gateAdvisory: {
        level: 'warn',
        blocksApproval: false,
      },
    })
    expect(result.review.knowledgeReferences.length).toBeGreaterThan(0)
    expect(result.trace.steps.map((step) => step.kind)).toEqual([
      'context',
      'retrieval',
      'provider_call',
      'artifact',
    ])
    expect(result.tokenUsage.source).toBe('provider_reported')
    expect(result.tokenUsage.inputTokens).toBeGreaterThan(0)
    expect(result.tokenUsage.costUsd).toBeGreaterThanOrEqual(0)
  })

  it('creates an Agent Review artifact and event without making gate advisory blocking', async () => {
    const context = buildAgentReviewContext({
      run,
      node,
      artifacts,
      testEvidence: [evidence],
      knowledgeDocuments,
      knowledgeChunks,
    })
    const result = await runKnowledgeReviewAgent({
      request: {
        id: 'review-request-2',
        runId: run.id,
        nodeId: node.id,
        projectId: run.projectId,
        requestedBy: 'u-ling',
        runtime: 'api',
      },
      context,
      provider: createFakeAgentProvider(),
      now: () => '2026-06-16T12:02:00.000Z',
    })
    const output = createAgentReviewArtifacts(result)

    expect(output.artifact.kind).toBe('agent_review')
    expect(output.artifact.redacted).toBe(true)
    expect(output.event.kind).toBe('agent_review')
    expect(output.gateAdvisory.blocksApproval).toBe(false)
  })
})

describe('estimateAgentTokenUsage', () => {
  it('marks token usage as estimated when provider usage is absent', () => {
    const usage = estimateAgentTokenUsage({
      id: 'usage-1',
      runId: run.id,
      nodeId: node.id,
      userId: 'u-ling',
      projectId: run.projectId,
      provider: 'openai',
      model: 'gpt-4.1-mini',
      prompt: 'review this design',
      completion: 'review complete',
      timestamp: '2026-06-16T12:03:00.000Z',
    })

    expect(usage.source).toBe('estimated')
    expect(usage.inputTokens).toBeGreaterThan(0)
    expect(usage.outputTokens).toBeGreaterThan(0)
  })
})
