import { describe, expect, it, vi } from 'vitest'
import {
  artifacts,
  knowledgeChunks,
  knowledgeDocuments,
  runs,
} from './fixtures'
import {
  assessAgentReviewFreshness,
  buildAgentReviewContext,
  createAgentReviewArtifacts,
  createFakeAgentProvider,
  createKnowledgeReviewPrompt,
  createOpenAiCompatibleAgentProvider,
  estimateAgentTokenUsage,
  estimateKnowledgeReviewCostPreflight,
  isTrustedNoCostKnowledgeReviewProvider,
  runBudgetedKnowledgeReviewAgent,
  runKnowledgeReviewAgent,
  KNOWLEDGE_REVIEW_MAX_ARTIFACT_CHARACTERS,
  type KnowledgeReviewBudgetGuardInput,
} from './agent-review'
import type { Artifact, TestEvidence } from './domain'

const run = runs[0]!
const node = run.nodes.find((item) => item.id === 'n-design-gate')!

describe('Knowledge Review cost preflight', () => {
  it('trusts only the exact built-in fake provider as no-cost', async () => {
    expect(
      isTrustedNoCostKnowledgeReviewProvider({
        id: 'fake-knowledge-review',
        model: 'fake',
      }),
    ).toBe(true)
    expect(
      isTrustedNoCostKnowledgeReviewProvider({
        id: 'fake-knowledge-review-lookalike',
        model: 'fake',
      }),
    ).toBe(false)
    expect(
      isTrustedNoCostKnowledgeReviewProvider({
        id: 'fake-knowledge-review',
        model: 'paid-model',
      }),
    ).toBe(false)
  })

  it('deterministically estimates the current real review request from its exact prompt and output cap', async () => {
    const context = await buildAgentReviewContext({
      run,
      node,
      artifacts,
      testEvidence: [],
      knowledgeDocuments,
      knowledgeChunks,
    })
    const request = {
      id: 'review-request-cost-preflight',
      runId: run.id,
      nodeId: node.id,
      projectId: run.projectId,
      requestedBy: 'u-ling',
      runtime: 'electron' as const,
      providerId: 'team-openai',
    }
    const input = {
      request,
      context,
      provider: { id: 'team-openai', model: 'gpt-4.1-mini' },
    }

    const preflight = estimateKnowledgeReviewCostPreflight(input)

    expect(preflight).toMatchObject({
      request,
      projectId: run.projectId,
      requestedBy: 'u-ling',
      providerId: 'team-openai',
      model: 'gpt-4.1-mini',
      prompt: createKnowledgeReviewPrompt(context),
      maxOutputTokens: 1_024,
      noCost: false,
    })
    expect(preflight.inputTokens).toBeGreaterThan(0)
    expect(preflight.projectedCostUsd).toBeGreaterThan(0)
    expect(estimateKnowledgeReviewCostPreflight(input)).toEqual(preflight)
  })

  it('does not let a real provider become no-cost by claiming the fake model name', async () => {
    const context = await buildAgentReviewContext({
      run,
      node,
      artifacts,
      testEvidence: [],
      knowledgeDocuments,
      knowledgeChunks,
    })
    const preflight = estimateKnowledgeReviewCostPreflight({
      request: {
        id: 'review-request-fake-model-lookalike',
        runId: run.id,
        nodeId: node.id,
        projectId: run.projectId,
        requestedBy: 'u-ling',
        runtime: 'electron',
      },
      context,
      provider: { id: 'team-provider', model: 'fake' },
    })

    expect(preflight.noCost).toBe(false)
    expect(preflight.projectedCostUsd).toBeGreaterThan(0)
  })
})

describe('runBudgetedKnowledgeReviewAgent', () => {
  it('blocks a real provider when no authoritative budget guard is available', async () => {
    const context = await buildAgentReviewContext({
      run,
      node,
      artifacts,
      testEvidence: [],
      knowledgeDocuments,
      knowledgeChunks,
    })
    const reviewKnowledge = vi.fn()

    const result = await runBudgetedKnowledgeReviewAgent({
      request: {
        id: 'review-request-missing-budget-guard',
        runId: run.id,
        nodeId: node.id,
        projectId: run.projectId,
        requestedBy: 'u-ling',
        runtime: 'electron',
      },
      context,
      provider: {
        id: 'team-openai',
        name: 'Team OpenAI',
        model: 'gpt-4.1-mini',
        reviewKnowledge,
      },
    })

    expect(result).toMatchObject({
      status: 'blocked',
      budgetDecision: {
        status: 'unavailable',
        blocksRun: true,
      },
      evidence: {
        kind: 'knowledge_review_budget_blocked',
        projectId: run.projectId,
        providerId: 'team-openai',
        redacted: true,
      },
    })
    expect(reviewKnowledge).not.toHaveBeenCalled()
  })

  it('runs the exact trusted fake provider without a guard under an explicit no-cost decision', async () => {
    const context = await buildAgentReviewContext({
      run,
      node,
      artifacts,
      testEvidence: [],
      knowledgeDocuments,
      knowledgeChunks,
    })
    const provider = createFakeAgentProvider()
    const reviewKnowledge = vi.spyOn(provider, 'reviewKnowledge')

    const result = await runBudgetedKnowledgeReviewAgent({
      request: {
        id: 'review-request-trusted-fake-no-cost',
        runId: run.id,
        nodeId: node.id,
        projectId: run.projectId,
        requestedBy: 'u-ling',
        runtime: 'electron',
      },
      context,
      provider,
      now: () => '2026-07-31T12:00:00.000Z',
    })

    expect(result).toMatchObject({
      status: 'completed',
      budgetDecision: {
        status: 'disabled',
        blocksRun: false,
        currentSpendUsd: 0,
        projectedCostUsd: 0,
      },
      execution: {
        review: { providerId: 'fake-knowledge-review' },
      },
    })
    expect(reviewKnowledge).toHaveBeenCalledTimes(1)
  })

  it('returns redacted blocked evidence without calling a provider when the guard rejects', async () => {
    const context = await buildAgentReviewContext({
      run,
      node,
      artifacts,
      testEvidence: [],
      knowledgeDocuments,
      knowledgeChunks,
    })
    const reviewKnowledge = vi.fn()
    const budgetGuard = vi.fn(async (_input: KnowledgeReviewBudgetGuardInput) => ({
      status: 'unavailable' as const,
      blocksRun: true,
      currentSpendUsd: 1,
      projectedCostUsd: 0.01,
      reason: 'Budget service failed with OPENAI_API_KEY=sk-secret.',
    }))

    const result = await runBudgetedKnowledgeReviewAgent({
      request: {
        id: 'review-request-budget-blocked',
        runId: run.id,
        nodeId: node.id,
        projectId: run.projectId,
        requestedBy: 'u-ling',
        runtime: 'api',
      },
      context,
      provider: {
        id: 'team-openai',
        name: 'Team OpenAI',
        model: 'gpt-4.1-mini',
        reviewKnowledge,
      },
      approvalId: 'approval-knowledge-1',
      budgetGuard,
    })

    expect(budgetGuard).toHaveBeenCalledTimes(1)
    const guardInput = budgetGuard.mock.calls[0]![0]
    expect(guardInput).toMatchObject({
      projectId: run.projectId,
      providerId: 'team-openai',
      requestedBy: 'u-ling',
      projectedCostUsd: expect.any(Number),
      approvalId: 'approval-knowledge-1',
    })
    expect(Object.keys(guardInput).sort()).toEqual([
      'approvalId',
      'projectId',
      'projectedCostUsd',
      'providerId',
      'requestedBy',
    ])
    expect(result).toMatchObject({
      status: 'blocked',
      evidence: {
        reason: expect.stringContaining('REDACTED'),
        redacted: true,
      },
    })
    expect(JSON.stringify(result)).not.toContain('sk-secret')
    expect(reviewKnowledge).not.toHaveBeenCalled()
  })

  it('runs the existing Knowledge Review agent once after the guard allows the paid call', async () => {
    const context = await buildAgentReviewContext({
      run,
      node,
      artifacts,
      testEvidence: [],
      knowledgeDocuments,
      knowledgeChunks,
    })
    const reviewKnowledge = vi.fn(async () => ({
      model: 'gpt-4.1-mini',
      conclusion: 'ready',
      summary: 'budget-authorized review',
      risks: [],
      missingEvidence: [],
      suggestedTests: [],
      confidence: 0.9,
    }))
    const budgetGuard = vi.fn(async (_input: KnowledgeReviewBudgetGuardInput) => ({
      status: 'allowed' as const,
      blocksRun: false,
      currentSpendUsd: 1,
      projectedCostUsd: 0.01,
      limitUsd: 20,
      reason: 'Within budget.',
    }))

    const result = await runBudgetedKnowledgeReviewAgent({
      request: {
        id: 'review-request-budget-allowed',
        runId: run.id,
        nodeId: node.id,
        projectId: run.projectId,
        requestedBy: 'u-ling',
        runtime: 'api',
      },
      context,
      provider: {
        id: 'team-openai',
        name: 'Team OpenAI',
        model: 'gpt-4.1-mini',
        reviewKnowledge,
      },
      budgetGuard,
      now: () => '2026-07-31T12:01:00.000Z',
    })

    expect(result).toMatchObject({
      status: 'completed',
      budgetDecision: { status: 'allowed', blocksRun: false },
      execution: { review: { summary: 'budget-authorized review' } },
    })
    expect(budgetGuard).toHaveBeenCalledTimes(1)
    expect(reviewKnowledge).toHaveBeenCalledTimes(1)
  })
})

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
  it('builds a minimal redacted review context without local-only evidence fields', async () => {
    const context = await buildAgentReviewContext({
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
    expect(context.knowledgeReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({
        lexicalMatch: expect.objectContaining({ normalized: false }),
        gateEvidence: { status: 'retrieval_candidate' },
      }),
    ]))
    expect(context.knowledgeReferences.every((reference) => reference.semanticRelevance === undefined)).toBe(true)
    expect(context.fieldProjection).toEqual(context.manifest.fieldProjection)
  })

  it('normalizes legacy non-string artifact fields before redaction', async () => {
    const legacyArtifact = {
      ...artifacts.find((artifact) => artifact.id === 'art-design')!,
      runId: run.id,
      summary: { reason: 'missing route contract' },
      content: { OPENAI_API_KEY: 'sk-secret', result: 'object content' },
    } as unknown as Artifact

    const context = await buildAgentReviewContext({
      run,
      node,
      artifacts: artifacts.map((artifact) =>
        artifact.id === legacyArtifact.id ? legacyArtifact : artifact,
      ),
      testEvidence: [],
      knowledgeDocuments,
      knowledgeChunks,
    })

    expect(context.artifacts.find((artifact) => artifact.id === legacyArtifact.id)).toMatchObject({
      summary: '{"reason":"missing route contract"}',
      content: expect.stringContaining('REDACTED'),
      redacted: true,
    })
    expect(JSON.stringify(context)).not.toContain('sk-secret')
  })

  it('redacts secrets and local absolute paths from repository knowledge before review', async () => {
    const document = knowledgeDocuments.find((item) => item.category === 'api_contract')!
    const sourceChunk = knowledgeChunks.find((item) => item.documentId === document.id)!
    const secret = 'sk-review-secret-123456'
    const localPath = '/Users/alice/private/payments-api/.env'
    const context = await buildAgentReviewContext({
      run,
      node,
      artifacts,
      testEvidence: [],
      knowledgeDocuments,
      knowledgeChunks: knowledgeChunks.map((chunk) =>
        chunk.id === sourceChunk.id
          ? {
              ...chunk,
              content: `Public API rule remains usable. OPENAI_API_KEY=${secret} config: ${localPath}`,
            }
          : chunk,
      ),
    })
    const reviewedChunk = context.knowledgeChunks.find((chunk) => chunk.id === sourceChunk.id)!
    const prompt = createKnowledgeReviewPrompt(context)

    expect(reviewedChunk.content).toContain('Public API rule remains usable.')
    expect(reviewedChunk.content).toContain('REDACTED')
    expect(JSON.stringify(context)).not.toContain('OPENAI_API_KEY')
    expect(JSON.stringify(context)).not.toContain(secret)
    expect(JSON.stringify(context)).not.toContain(localPath)
    expect(prompt).not.toContain(secret)
    expect(prompt).not.toContain(localPath)
  })

  it('deterministically bounds large repository chunks and uses the exact preflight prompt', async () => {
    const documentTemplate = knowledgeDocuments.find((item) => item.category === 'api_contract')!
    const chunkTemplate = knowledgeChunks.find((item) => item.documentId === documentTemplate.id)!
    const largeDocuments = Array.from({ length: 9 }, (_, index) => ({
      ...documentTemplate,
      id: `knowledge-document-large-${index}`,
      title: `Large API contract ${index}`,
      sourcePath: `docs/api-contract-${index}.md`,
    }))
    const largeChunks = largeDocuments.map((document, index) => ({
      ...chunkTemplate,
      id: `knowledge-chunk-large-${index}`,
      documentId: document.id,
      sourcePath: document.sourcePath,
      content: `Chunk ${index} usable rule. ${String(index).repeat(220_000)}`,
    }))
    const input = {
      run,
      node,
      artifacts,
      testEvidence: [],
      knowledgeDocuments: largeDocuments,
      knowledgeChunks: largeChunks,
    }

    const context = await buildAgentReviewContext(input)
    const repeatedContext = await buildAgentReviewContext(input)
    const contentCharacters = context.knowledgeChunks.reduce(
      (total, chunk) => total + chunk.content.length,
      0,
    )
    const provider = createFakeAgentProvider()
    const reviewKnowledge = vi.spyOn(provider, 'reviewKnowledge')
    const request = {
      id: 'review-request-large-knowledge',
      runId: run.id,
      nodeId: node.id,
      projectId: run.projectId,
      requestedBy: 'u-ling',
      runtime: 'electron' as const,
    }
    const preflight = estimateKnowledgeReviewCostPreflight({ request, context, provider })

    await runKnowledgeReviewAgent({ request, context, provider })

    expect(context).toEqual(repeatedContext)
    expect(context.knowledgeChunks.length).toBeLessThanOrEqual(8)
    expect(context.knowledgeChunks.every((chunk) => chunk.content.length <= 4_000)).toBe(true)
    expect(contentCharacters).toBeLessThanOrEqual(24_000)
    expect(preflight.prompt.length).toBeLessThan(96_000)
    expect(reviewKnowledge).toHaveBeenCalledTimes(1)
    expect(reviewKnowledge.mock.calls[0]![0].prompt).toBe(preflight.prompt)
  })

  it('sends the original request and complete clarification/design bodies as Subject while keeping Knowledge as Criteria', async () => {
    const requestCanary = 'REQUEST_ONLY_CANARY preserve backward compatibility'
    const clarificationCanary = 'ASSUMPTION_ONLY_CANARY upstream service remains available'
    const designCanary = 'OPEN_QUESTION_ONLY_CANARY migration order is unresolved'
    const criteriaCanary = 'KNOWLEDGE_ONLY_CANARY use contract tests'
    const secret = 'sk-review-secret-1234567890'
    const localPath = '/Users/alice/private/review/.env'
    const reviewRun = { ...run, request: `${run.request}\n${requestCanary}` }
    const reviewArtifacts = artifacts.map((artifact) => {
      if (artifact.id === 'art-clarify') {
        return {
          ...artifact,
          summary: 'Harmless clarification summary.',
          content: [
            'Goals:',
            'Clarify the health endpoint.',
            'Acceptance Criteria:',
            'Return explicit status codes.',
            'Non-goals:',
            'Do not replace auth.',
            'Assumptions:',
            clarificationCanary,
            'Risks:',
            'Redis timeout may hide a degraded state.',
            'Open Questions:',
            'Who owns the production probe?',
          ].join('\n'),
        }
      }
      if (artifact.id === 'art-design') {
        return {
          ...artifact,
          summary: 'Harmless design summary.',
          content: [
            'Goals:',
            'Add the route without broad changes.',
            'Assumptions:',
            `OPENAI_API_KEY=${secret}`,
            `Local diagnostic path: ${localPath}`,
            'Risks:',
            'The compatibility contract may conflict with the approved requirement.',
            'Open Questions:',
            designCanary,
          ].join('\n'),
        }
      }
      return artifact
    })
    const criteriaChunks = knowledgeChunks.map((chunk, index) =>
      index === 0 ? { ...chunk, content: `${chunk.content}\n${criteriaCanary}` } : chunk,
    )

    const context = await buildAgentReviewContext({
      run: reviewRun,
      node,
      artifacts: reviewArtifacts,
      testEvidence: [evidence],
      knowledgeDocuments,
      knowledgeChunks: criteriaChunks,
    })
    const prompt = createKnowledgeReviewPrompt(context)

    expect(context.subjectArtifacts.map((artifact) => artifact.kind)).toEqual([
      'clarification',
      'design',
    ])
    expect(prompt).toContain(requestCanary)
    expect(prompt).toContain(clarificationCanary)
    expect(prompt).toContain(designCanary)
    expect(prompt).toContain('Acceptance Criteria:')
    expect(prompt).toContain(criteriaCanary)
    expect(prompt).toContain('"REVIEW_SUBJECT"')
    expect(prompt).toContain('"REVIEW_CRITERIA"')
    expect(prompt.indexOf(designCanary)).toBeLessThan(prompt.indexOf(criteriaCanary))
    expect(prompt).not.toContain(secret)
    expect(prompt).not.toContain(localPath)
    expect(prompt).toContain('[REDACTED')
    expect(context.manifest).toMatchObject({
      version: 1,
      stage: 'design',
      coverage: 'complete',
      criteriaCoverage: 'available',
      subjectArtifacts: [
        { id: 'art-clarify', kind: 'clarification', coverage: 'complete' },
        { id: 'art-design', kind: 'design', coverage: 'complete' },
      ],
    })
    expect(context.manifest.subjectArtifacts.every((artifact) =>
      artifact.contentDigest.match(/^[a-f0-9]{64}$/u))).toBe(true)
    expect(JSON.stringify(context.manifest)).not.toContain('completeRedactedContentChunks')
    expect(JSON.stringify(context.manifest)).not.toContain(designCanary)
  })

  it('uses deterministic complete chunking and fails closed instead of silently truncating an oversized subject', async () => {
    const chunkedContent = `Goals:\n${'chunk-body '.repeat(700)}`
    const chunkedArtifacts = artifacts.map((artifact) =>
      artifact.id === 'art-design' ? { ...artifact, content: chunkedContent } : artifact,
    )
    const first = await buildAgentReviewContext({
      run,
      node,
      artifacts: chunkedArtifacts,
      testEvidence: [],
      knowledgeDocuments,
      knowledgeChunks,
    })
    const second = await buildAgentReviewContext({
      run,
      node,
      artifacts: chunkedArtifacts,
      testEvidence: [],
      knowledgeDocuments,
      knowledgeChunks,
    })
    const chunked = first.subjectArtifacts.find((artifact) => artifact.id === 'art-design')!

    expect(first.manifest.coverage).toBe('deterministically_chunked')
    expect(chunked.coverage).toBe('deterministically_chunked')
    expect(chunked.chunks.map((chunk) => chunk.content).join('')).toBe(chunkedContent)
    expect(second.manifest).toEqual(first.manifest)

    const oversizedArtifacts = artifacts.map((artifact) =>
      artifact.id === 'art-design'
        ? { ...artifact, content: 'x'.repeat(KNOWLEDGE_REVIEW_MAX_ARTIFACT_CHARACTERS + 1) }
        : artifact,
    )
    const incomplete = await buildAgentReviewContext({
      run,
      node,
      artifacts: oversizedArtifacts,
      testEvidence: [],
      knowledgeDocuments,
      knowledgeChunks,
    })
    const reviewKnowledge = vi.fn()

    expect(incomplete.manifest.coverage).toBe('incomplete')
    expect(() => createKnowledgeReviewPrompt(incomplete)).toThrow(/coverage is incomplete/i)
    await expect(runKnowledgeReviewAgent({
      request: {
        id: 'review-request-oversized',
        runId: run.id,
        nodeId: node.id,
        projectId: run.projectId,
        requestedBy: 'u-ling',
        runtime: 'electron',
      },
      context: incomplete,
      provider: {
        id: 'capture-provider',
        name: 'Capture Provider',
        model: 'gpt-4.1-mini',
        reviewKnowledge,
      },
    })).rejects.toThrow(/coverage is incomplete/i)
    expect(reviewKnowledge).not.toHaveBeenCalled()
  })

  it('fails closed for missing, ambiguous, wrong-run, and wrong-node Artifact associations', async () => {
    const input = {
      run,
      node,
      testEvidence: [],
      knowledgeDocuments,
      knowledgeChunks,
    }

    await expect(buildAgentReviewContext({
      ...input,
      artifacts: artifacts.filter((artifact) => artifact.id !== 'art-design'),
    })).rejects.toThrow(/art-design is missing/i)
    await expect(buildAgentReviewContext({
      ...input,
      artifacts: [...artifacts, { ...artifacts.find((artifact) => artifact.id === 'art-design')! }],
    })).rejects.toThrow(/art-design is ambiguous/i)
    await expect(buildAgentReviewContext({
      ...input,
      artifacts: artifacts.map((artifact) =>
        artifact.id === 'art-design' ? { ...artifact, runId: 'wrong-run' } : artifact,
      ),
    })).rejects.toThrow(/art-design is missing/i)
    await expect(buildAgentReviewContext({
      ...input,
      artifacts: artifacts.map((artifact) =>
        artifact.id === 'art-design' ? { ...artifact, nodeId: 'n-test' } : artifact,
      ),
    })).rejects.toThrow(/wrong workflow node/i)
  })

  it('marks a completed Review stale when a subject body changes or an Artifact is replaced', async () => {
    const context = await buildAgentReviewContext({
      run,
      node,
      artifacts,
      testEvidence: [],
      knowledgeDocuments,
      knowledgeChunks,
    })
    const result = await runKnowledgeReviewAgent({
      request: {
        id: 'review-request-freshness',
        runId: run.id,
        nodeId: node.id,
        projectId: run.projectId,
        requestedBy: 'u-ling',
        runtime: 'electron',
      },
      context,
      provider: createFakeAgentProvider(),
      now: () => '2026-06-16T12:05:00.000Z',
    })

    await expect(assessAgentReviewFreshness({
      review: result.review,
      run,
      node,
      artifacts,
    })).resolves.toEqual({ status: 'current', reasons: [] })
    const changed = artifacts.map((artifact) =>
      artifact.id === 'art-design'
        ? { ...artifact, content: `${artifact.content}\nRisk: digest-only change`, updatedAt: artifact.updatedAt }
        : artifact,
    )
    await expect(assessAgentReviewFreshness({
      review: result.review,
      run,
      node,
      artifacts: changed,
    })).resolves.toMatchObject({ status: 'stale', reasons: [expect.stringContaining('content revision')] })
    const replacementNode = {
      ...node,
      artifactIds: ['art-design-v2'],
    }
    const replacement = artifacts
      .filter((artifact) => artifact.id !== 'art-design')
      .concat({
        ...artifacts.find((artifact) => artifact.id === 'art-design')!,
        id: 'art-design-v2',
        updatedAt: '2026-06-16T12:06:00.000Z',
      })
    await expect(assessAgentReviewFreshness({
      review: result.review,
      run: {
        ...run,
        nodes: run.nodes.map((candidate) => candidate.id === node.id ? replacementNode : candidate),
      },
      node: replacementNode,
      artifacts: replacement,
    })).resolves.toMatchObject({ status: 'stale', reasons: expect.arrayContaining([
      expect.stringContaining('replaced'),
    ]) })
  })

  it('lets the deterministic fake inspect risks present only in the Artifact body', async () => {
    const riskyArtifacts = artifacts.map((artifact) =>
      artifact.id === 'art-design'
        ? {
            ...artifact,
            summary: 'Everything is routine.',
            content: `${artifact.content}\nOpen Questions: BLOCKER_CANARY compatibility conflict is unresolved.`,
          }
        : artifact,
    )
    const context = await buildAgentReviewContext({
      run,
      node,
      artifacts: riskyArtifacts,
      testEvidence: [evidence],
      knowledgeDocuments,
      knowledgeChunks,
    })
    const output = await createFakeAgentProvider().reviewKnowledge({
      request: {
        id: 'review-request-fake-body-risk',
        runId: run.id,
        nodeId: node.id,
        projectId: run.projectId,
        requestedBy: 'u-ling',
        runtime: 'electron',
      },
      context,
      prompt: createKnowledgeReviewPrompt(context),
    })

    expect(output.risks).toEqual(expect.arrayContaining([
      expect.stringContaining('BLOCKER_CANARY'),
    ]))
  })

  it('keeps a local-only Review usable without Team Knowledge while declaring criteria unavailable', async () => {
    const context = await buildAgentReviewContext({
      run,
      node,
      artifacts,
      testEvidence: [],
      knowledgeDocuments: [],
      knowledgeChunks: [],
    })
    const provider = createFakeAgentProvider()

    expect(context.manifest.criteriaCoverage).toBe('unavailable')
    expect(context.knowledgeChunks).toEqual([])
    await expect(runKnowledgeReviewAgent({
      request: {
        id: 'review-request-local-no-knowledge',
        runId: run.id,
        nodeId: node.id,
        projectId: run.projectId,
        requestedBy: 'u-ling',
        runtime: 'electron',
      },
      context,
      provider,
    })).resolves.toMatchObject({
      review: {
        contextManifest: { criteriaCoverage: 'unavailable' },
        gateAdvisory: { blocksApproval: false },
      },
    })
  })

  it('omits an inapplicable empty Test Evidence field from a clarification Gate prompt', async () => {
    const clarifyGate = run.nodes.find((candidate) => candidate.kind === 'gate' && candidate.stage === 'clarify')!
    const context = await buildAgentReviewContext({
      run,
      node: clarifyGate,
      artifacts,
      testEvidence: [],
      knowledgeDocuments,
      knowledgeChunks,
    })
    const prompt = createKnowledgeReviewPrompt(context)

    expect(context.testEvidence).toEqual([])
    expect(context.fieldProjection?.fields.find((field) => field.field === 'test_evidence')).toMatchObject({
      state: 'not_applicable',
      includeInProviderPrompt: false,
    })
    expect(prompt).not.toContain('supplementalTestEvidence')
    expect(prompt).toContain('"state":"not_applicable"')
  })
})

describe('runKnowledgeReviewAgent', () => {
  it('returns deterministic structured review output with trace and provider usage', async () => {
    const context = await buildAgentReviewContext({
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
      conclusion: expect.stringContaining('Gate Review'),
      confidence: expect.any(Number),
      gateAdvisory: {
        level: 'warn',
        blocksApproval: false,
      },
    })
    expect(result.review.knowledgeReferences.length).toBeGreaterThan(0)
    expect(result.review.knowledgeReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({
        gateEvidence: expect.objectContaining({
          status: expect.stringMatching(/^(reviewed_reference|supports_finding)$/),
          reviewId: result.review.id,
        }),
      }),
    ]))
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

  it('derives deterministic missing-evidence findings only when policy requires Test Evidence', async () => {
    const context = await buildAgentReviewContext({
      run,
      node,
      artifacts,
      testEvidence: [],
      knowledgeDocuments,
      knowledgeChunks,
      requiredContextFields: { test_evidence: true },
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
          summary: expect.stringContaining('passing local test evidence required'),
        }),
      ]),
    )
  })

  it('does not invent missing Test Evidence for an early Gate where it is optional', async () => {
    const context = await buildAgentReviewContext({
      run,
      node,
      artifacts,
      testEvidence: [],
      knowledgeDocuments,
      knowledgeChunks,
    })
    const result = await runKnowledgeReviewAgent({
      request: {
        id: 'review-request-no-early-test-gap',
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

    expect(result.review.missingEvidence).toEqual([])
    expect(result.review.policyFindings.map((finding) => finding.category)).not.toContain('missing_evidence')
    expect(createKnowledgeReviewPrompt(context)).not.toContain('supplementalTestEvidence')
  })

  it('creates an Agent Review artifact and event without making gate advisory blocking', async () => {
    const context = await buildAgentReviewContext({
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
    expect(output.artifact.content).toContain('Design review assessment:')
    expect(output.artifact.content).toContain('Requirement coverage:')
    expect(output.artifact.content).toContain('API, compatibility, security, and migration risks:')
    expect(output.event.kind).toBe('agent_review')
    expect(output.gateAdvisory.blocksApproval).toBe(false)
  })
})

describe('estimateAgentTokenUsage', () => {
  it('marks token usage as estimated when provider usage is absent', async () => {
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
  it('provides one strict bounded structured JSON decision seam with provider usage', async () => {
    let requestBody: Record<string, unknown> | undefined
    let redirect: RequestRedirect | undefined
    const provider = createOpenAiCompatibleAgentProvider({
      model: 'gpt-native-coding',
      apiKey: 'secret-key',
      fetcher: async (_, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        redirect = init?.redirect
        return new Response(JSON.stringify({
          choices: [{ message: { content: '{"stateVersion":1,"ok":true}' } }],
          usage: { prompt_tokens: 21, completion_tokens: 8, cached_tokens: 3 },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      },
    })
    expect(provider.billingProvider).toBe('openai_compatible')

    await expect(provider.completeStructuredJson?.({
      systemPrompt: 'Return one exact JSON object.',
      userPrompt: 'Choose one bounded edit.',
      maxOutputTokens: 1_024,
    })).resolves.toEqual({
      value: { stateVersion: 1, ok: true },
      usage: {
        inputTokens: 21,
        outputTokens: 8,
        cacheReadTokens: 3,
        cacheMissTokens: 18,
        cacheStatus: 'complete',
        billingProvider: 'openai_compatible',
      },
    })
    expect(requestBody).toMatchObject({
      model: 'gpt-native-coding',
      temperature: 0,
      max_tokens: 1_024,
    })
    expect(redirect).toBe('error')
  })

  it('preserves the exact DeepSeek cache hit/miss partition at the HTTP boundary', async () => {
    const provider = createOpenAiCompatibleAgentProvider({
      id: 'deepseek-production',
      model: 'deepseek-v4-flash',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'secret-key',
      fetcher: async () => new Response(JSON.stringify({
        choices: [{ message: { content: '{"stateVersion":2,"ok":true}' } }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          prompt_cache_hit_tokens: 40,
          prompt_cache_miss_tokens: 60,
          total_tokens: 120,
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    })
    expect(provider.billingProvider).toBe('deepseek')

    await expect(provider.completeStructuredJson?.({
      systemPrompt: 'Return JSON.', userPrompt: 'Plan.', maxOutputTokens: 100,
    })).resolves.toMatchObject({
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 40,
        cacheMissTokens: 60,
        totalTokens: 120,
        cacheStatus: 'complete',
        billingProvider: 'deepseek',
      },
    })
  })

  it('accepts one json Markdown fence but rejects prose or nested fences', async () => {
    const responseFor = (content: string) => new Response(JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
    const fenced = createOpenAiCompatibleAgentProvider({
      model: 'deepseek-v4-flash',
      apiKey: 'secret-key',
      fetcher: async () => responseFor('```json\n{"stateVersion":2,"ok":true}\n```'),
    })
    expect(fenced.billingProvider).toBe('openai_compatible')
    await expect(fenced.completeStructuredJson?.({
      systemPrompt: 'Return JSON.', userPrompt: 'Plan.', maxOutputTokens: 100,
    })).resolves.toMatchObject({ value: { stateVersion: 2, ok: true } })

    for (const content of [
      'Here is JSON: {"stateVersion":2}',
      '```json\n```json\n{"stateVersion":2}\n```\n```',
    ]) {
      const invalid = createOpenAiCompatibleAgentProvider({
        model: 'deepseek-v4-flash',
        apiKey: 'secret-key',
        fetcher: async () => responseFor(content),
      })
      await expect(invalid.completeStructuredJson?.({
        systemPrompt: 'Return JSON.', userPrompt: 'Plan.', maxOutputTokens: 100,
      })).rejects.toThrow('Agent provider structured output is invalid')
    }
  })

  it('caps Knowledge Review output tokens before calling a real compatible provider', async () => {
    let requestBody: Record<string, unknown> | undefined
    const provider = createOpenAiCompatibleAgentProvider({
      model: 'ark-code-latest',
      apiKey: 'secret-key',
      fetcher: async (_, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    conclusion: 'ok',
                    summary: 'bounded review',
                    risks: [],
                    missingEvidence: [],
                    suggestedTests: [],
                    confidence: 0.8,
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      },
    })

    const context = await buildAgentReviewContext({
      run: { ...run, request: `${run.request} REQUEST_PROVIDER_CANARY` },
      node,
      artifacts: artifacts.map((artifact) =>
        artifact.id === 'art-design'
          ? { ...artifact, content: `${artifact.content}\nRisks: PROVIDER_BODY_ONLY_CANARY` }
          : artifact,
      ),
      testEvidence: [],
      knowledgeDocuments,
      knowledgeChunks,
    })
    await provider.reviewKnowledge({
      request: {
        id: 'review-request-bounded-output',
        runId: run.id,
        nodeId: node.id,
        projectId: run.projectId,
        requestedBy: 'u-ling',
        runtime: 'api',
      },
      context,
      prompt: createKnowledgeReviewPrompt(context),
    })

    expect(requestBody).toMatchObject({ max_tokens: 1_024 })
    expect(JSON.stringify(requestBody)).toContain('REQUEST_PROVIDER_CANARY')
    expect(JSON.stringify(requestBody)).toContain('PROVIDER_BODY_ONLY_CANARY')
  })

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
      context: await buildAgentReviewContext({
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
      context: await buildAgentReviewContext({
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

  it('generates workflow artifacts with the OpenAI-compatible chat endpoint', async () => {
    let requestBody: Record<string, unknown> | undefined
    const provider = createOpenAiCompatibleAgentProvider({
      id: 'doubao-review',
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
                    title: '需求澄清结果',
                    summary: 'live clarification',
                    goals: ['clarify scope'],
                    acceptanceCriteria: ['approval criteria captured'],
                    nonGoals: ['no unrelated changes'],
                    openQuestions: ['confirm copy tone'],
                    assumptions: ['local only'],
                    risks: [],
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 20, completion_tokens: 10 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      },
    })

    const output = await provider.generateWorkflowArtifact?.({
      request: {
        id: 'workflow-request-1',
        runId: run.id,
        nodeId: node.id,
        projectId: run.projectId,
        requestedBy: 'u-ling',
        runtime: 'electron',
        stage: 'clarify',
        providerId: 'doubao-review',
      },
      context: {
        run: {
          id: run.id,
          title: run.title,
          request: run.request,
          projectId: run.projectId,
          status: run.status,
          branchName: run.branchName,
        },
        node,
        artifacts,
      },
      prompt: 'Return a clarification artifact.',
    })

    expect(requestBody).toMatchObject({
      model: 'ark-code-latest',
      temperature: 0.2,
    })
    expect(requestBody).not.toHaveProperty('response_format')
    expect(JSON.stringify(requestBody)).toContain('Return only valid JSON with title')
    expect(output).toMatchObject({
      model: 'ark-code-latest',
      summary: 'live clarification',
      goals: ['clarify scope'],
      usage: { inputTokens: 20, outputTokens: 10 },
    })
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

    const context = await buildAgentReviewContext({
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
                'bad request OPENAI_API_KEY=sk-secret [redacted-provider-token]',
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
        context: await buildAgentReviewContext({
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
        context: await buildAgentReviewContext({
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
