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
  createOpenAiCompatibleAgentProvider,
  estimateAgentTokenUsage,
  runKnowledgeReviewAgent,
} from './agent-review'
import type { Artifact, TestEvidence } from './domain'

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

  it('normalizes legacy non-string artifact fields before redaction', () => {
    const legacyArtifact = {
      ...artifacts[0]!,
      runId: run.id,
      nodeId: node.id,
      summary: { reason: 'missing route contract' },
      content: { OPENAI_API_KEY: 'sk-secret', result: 'object content' },
    } as unknown as Artifact

    const context = buildAgentReviewContext({
      run,
      node,
      artifacts: [legacyArtifact],
      testEvidence: [],
      knowledgeDocuments,
      knowledgeChunks,
    })

    expect(context.artifacts[0]).toMatchObject({
      summary: '{"reason":"missing route contract"}',
      content: expect.stringContaining('REDACTED'),
      redacted: true,
    })
    expect(JSON.stringify(context)).not.toContain('sk-secret')
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
    expect(result.review.policyFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'review_gap',
          severity: 'low',
        }),
      ]),
    )
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

  it('derives deterministic missing-evidence policy findings when evidence is absent', async () => {
    const context = buildAgentReviewContext({
      run,
      node,
      artifacts,
      testEvidence: [],
      knowledgeDocuments,
      knowledgeChunks,
    })
    const result = await runKnowledgeReviewAgent({
      request: {
        id: 'review-request-missing-evidence',
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

    expect(result.review.policyFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'missing_evidence',
          severity: 'medium',
          summary: expect.stringContaining('passing local test evidence'),
        }),
      ]),
    )
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
    expect(output.artifact.content).toContain('Policy findings:')
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

describe('createOpenAiCompatibleAgentProvider', () => {
  it('sends a plain chat-completions request without provider-specific JSON mode', async () => {
    let requestBody: Record<string, unknown> | undefined
    const provider = createOpenAiCompatibleAgentProvider({
      model: 'ark-code-latest',
      apiKey: 'secret-key',
      baseUrl: 'https://ark.example.com/api/coding/v3',
      fetcher: async (_, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    conclusion: 'ok',
                    summary: 'structured review',
                    risks: [],
                    missingEvidence: [],
                    suggestedTests: ['pnpm test'],
                    confidence: 0.8,
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 12, completion_tokens: 8 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      },
    })

    const output = await provider.reviewKnowledge({
      request: {
        id: 'review-request-openai-compatible',
        runId: run.id,
        nodeId: node.id,
        projectId: run.projectId,
        requestedBy: 'u-ling',
        runtime: 'api',
      },
      context: buildAgentReviewContext({
        run,
        node,
        artifacts,
        testEvidence: [],
        knowledgeDocuments,
        knowledgeChunks,
      }),
      prompt: 'Return a review.',
    })

    expect(requestBody).toMatchObject({
      model: 'ark-code-latest',
      temperature: 0.2,
    })
    expect(requestBody).not.toHaveProperty('response_format')
    expect(JSON.stringify(requestBody)).toContain('Return only valid JSON')
    expect(output.summary).toBe('structured review')
    expect(output.usage).toMatchObject({ inputTokens: 12, outputTokens: 8 })
  })

  it('parses JSON when providers wrap the object in text or markdown', async () => {
    const provider = createOpenAiCompatibleAgentProvider({
      model: 'ark-code-latest',
      apiKey: 'secret-key',
      fetcher: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '```json\n{"conclusion":"ok","summary":"wrapped","risks":[],"missingEvidence":[],"suggestedTests":[],"confidence":0.7}\n```',
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    })

    const output = await provider.reviewKnowledge({
      request: {
        id: 'review-request-wrapped-json',
        runId: run.id,
        nodeId: node.id,
        projectId: run.projectId,
        requestedBy: 'u-ling',
        runtime: 'api',
      },
      context: buildAgentReviewContext({
        run,
        node,
        artifacts,
        testEvidence: [],
        knowledgeDocuments,
        knowledgeChunks,
      }),
      prompt: 'Return a review.',
    })

    expect(output.summary).toBe('wrapped')
  })

  it('normalizes non-string provider fields before downstream redaction and findings', async () => {
    const provider = createOpenAiCompatibleAgentProvider({
      model: 'ark-code-latest',
      apiKey: 'secret-key',
      fetcher: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    conclusion: { status: 'needs_changes' },
                    summary: { reason: 'missing route contract' },
                    risks: [{ issue: 'missing status mapping' }],
                    missingEvidence: [{ evidence: 'HTTP status matrix' }],
                    suggestedTests: [{ command: 'pnpm test' }],
                    confidence: 0.7,
                    policyFindings: [
                      {
                        category: 'missing_evidence',
                        severity: 'medium',
                        summary: { item: 'Design contract missing' },
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    })

    const context = buildAgentReviewContext({
      run,
      node,
      artifacts,
      testEvidence: [],
      knowledgeDocuments,
      knowledgeChunks,
    })
    const result = await runKnowledgeReviewAgent({
      request: {
        id: 'review-request-object-fields',
        runId: run.id,
        nodeId: node.id,
        projectId: run.projectId,
        requestedBy: 'u-ling',
        runtime: 'api',
      },
      context,
      provider,
      now: () => '2026-06-16T12:04:00.000Z',
    })
    const output = createAgentReviewArtifacts(result)

    expect(result.review.summary).toBe('{"reason":"missing route contract"}')
    expect(result.review.risks).toEqual(['{"issue":"missing status mapping"}'])
    expect(result.review.missingEvidence).toEqual(['{"evidence":"HTTP status matrix"}'])
    expect(result.review.policyFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary: '{"item":"Design contract missing"}',
        }),
      ]),
    )
    expect(output.artifact.content).toContain('{"item":"Design contract missing"}')
  })

  it('includes redacted provider error details on request failure', async () => {
    const provider = createOpenAiCompatibleAgentProvider({
      model: 'ark-code-latest',
      apiKey: 'secret-key',
      fetcher: async () =>
        new Response(
          JSON.stringify({
            error: {
              message:
                'bad request OPENAI_API_KEY=sk-secret 6363516a-2de2-4d35-8d6e-b99f6c2f15f2',
            },
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        ),
    })

    await expect(
      provider.reviewKnowledge({
        request: {
          id: 'review-request-error',
          runId: run.id,
          nodeId: node.id,
          projectId: run.projectId,
          requestedBy: 'u-ling',
          runtime: 'api',
        },
        context: buildAgentReviewContext({
          run,
          node,
          artifacts,
          testEvidence: [],
          knowledgeDocuments,
          knowledgeChunks,
        }),
        prompt: 'Return a review.',
      }),
    ).rejects.toThrow('Agent provider failed with 400')
    await expect(
      provider.reviewKnowledge({
        request: {
          id: 'review-request-error',
          runId: run.id,
          nodeId: node.id,
          projectId: run.projectId,
          requestedBy: 'u-ling',
          runtime: 'api',
        },
        context: buildAgentReviewContext({
          run,
          node,
          artifacts,
          testEvidence: [],
          knowledgeDocuments,
          knowledgeChunks,
        }),
        prompt: 'Return a review.',
      }),
    ).rejects.not.toThrow(/sk-secret|6363516a/u)
  })
})
