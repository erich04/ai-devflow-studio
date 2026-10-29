import { describe, expect, it, vi } from 'vitest'
import {
  createFakeAgentProvider,
  AgentProviderRequestError,
  stageAgentFailureDetails,
  createOpenAiCompatibleAgentProvider,
  createRecommendedEnforcementPreset,
  resolveEffectivePolicy,
  assembleRetrievedKnowledgeContext,
  type AgentEvent,
  type AgentProvider,
  type AgentReviewResult,
  type AgentTokenUsage,
  type AgentTrace,
  type Artifact,
  type LocalExecutionState,
  type NodeStage,
  type PolicySnapshot,
  type TestEvidence,
  type WorkflowRun,
  type DesktopPairingCredential,
} from '@ai-devflow/shared'
import { artifacts, knowledgeChunks, knowledgeDocuments, runs } from '@ai-devflow/shared/fixtures'
import {
  createKnowledgeReviewRuntime,
  type KnowledgeReviewRuntimeStore,
} from './knowledge-review-runtime'
import { registerProjectMemoryRecall } from './coding-context'
import { projectMemoryIdentity } from './project-memory-recall'

describe('KnowledgeReviewRuntime', () => {
  it.each(['clarify', 'design', 'build', 'test', 'pr', 'accept'] as const)(
    'shares ordinary private Memory with the %s review without treating it as approved criteria', async (stage) => {
      const { run: reviewRun, node: reviewNode } = stageReviewFixture(stage)
      const store = new MemoryEnabledReviewStore()
      vi.spyOn(store, 'listRuns').mockResolvedValue([reviewRun])
      const delegate = createFakeAgentProvider()
      const received: Array<Parameters<AgentProvider['reviewKnowledge']>[0]> = []
      const provider: AgentProvider = { ...delegate, async reviewKnowledge(input) { received.push(input); return delegate.reviewKnowledge(input) } }
      const runtime = createKnowledgeReviewRuntime({
        store, knowledgeDocuments, knowledgeChunks, now: () => reviewMemoryTime,
        resolveProviderMetadata: async () => provider, resolveProvider: async () => provider,
      })
      const result = await runtime.run({ ...reviewInput(provider.id), nodeId: reviewNode.id })
      expect(received).toHaveLength(1)
      const actual = received[0]!
      const data = JSON.parse(actual.prompt.split('\n').at(-1)!)
      expect(data.BACKGROUND_EXPERIENCE).toEqual([expect.objectContaining({ id: store.memory.id, statement: store.memory.statement })])
      expect(JSON.stringify(data.REVIEW_CRITERIA)).not.toContain(store.memory.statement)
      expect(actual.prompt).toContain('cannot establish a requirement, permission, approval, test result')
      expect(result.review.contextManifest?.backgroundMemory).toEqual({
        memories: [{ id: store.memory.id, revision: 1, headVersion: 1, contentDigest: store.memory.contentDigest }], omittedCount: 0,
      })
      expect(result.review.contextManifest).toEqual(actual.context.manifest)
      expect(store.reviews).toHaveLength(1)
      expect(reviewRun.currentNodeId).toBe(reviewNode.id)
    },
  )

  it.each(['before_dispatch', 'after_dispatch', 'scope_changed'] as const)(
    'rejects stale review Memory at the %s boundary', async (scenario) => {
      const store = new MemoryEnabledReviewStore()
      const delegate = createFakeAgentProvider()
      const reviewKnowledge = vi.fn(async (input: Parameters<AgentProvider['reviewKnowledge']>[0]) => {
        const result = await delegate.reviewKnowledge(input)
        if (scenario === 'after_dispatch') store.changed = true
        if (scenario === 'scope_changed') store.pairing = {
          tokenId: 'new-session', localProjectId: fixtureRun.projectId, projectId: 'team-project', organizationId: 'org', userId: 'u-ling',
          role: 'member', authAccountId: 'account', projectMemberships: [], createdAt: reviewMemoryTime,
        }
        return result
      })
      const provider: AgentProvider = { ...delegate, reviewKnowledge }
      const runtime = createKnowledgeReviewRuntime({
        store, knowledgeDocuments, knowledgeChunks, now: () => reviewMemoryTime,
        resolveProviderMetadata: async () => provider,
        resolveProvider: async () => { if (scenario === 'before_dispatch') store.changed = true; return provider },
      })
      await expect(runtime.run(reviewInput(provider.id))).rejects.toThrow()
      expect(reviewKnowledge).toHaveBeenCalledTimes(scenario === 'before_dispatch' ? 0 : 1)
      expect(store.savedArtifacts).toHaveLength(0)
      expect(store.reviews).toHaveLength(0)
    },
  )
  describe.each(['direct-provider', 'local-agent'] as const)('retrieved knowledge through the %s review boundary', (executorKind) => {
    it.each(['clarify', 'design', 'build', 'test', 'pr', 'accept'] as const)(
      'delivers current %s knowledge to the provider and persists its receipt without approving the workflow',
      async (stage) => {
        const { run: reviewRun, node: reviewNode } = stageReviewFixture(stage)
        const store = new MemoryKnowledgeReviewStore()
        vi.spyOn(store, 'listRuns').mockResolvedValue([reviewRun])
        const before = structuredClone(reviewRun)
        const source = {
          sourceRef: `${stage}-source-v1`, path: `docs/knowledge/${stage}-rules.md`,
          title: `${stage} rules`, contentDigest: `sha256:${'a'.repeat(64)}`,
          matchReason: 'both' as const,
          content: `CURRENT_${stage.toUpperCase()}_RULE: preserve unfinished tasks and apply the seven-day cleanup boundary.`,
        }
        const retrievedKnowledge = assembleRetrievedKnowledgeContext({
          stage, scope: { projectId: reviewRun.projectId, userId: 'u-ling' },
          queryDigest: `sha256:${'b'.repeat(64)}`, configGeneration: 'six-stage-generation',
          modelVersion: 'todo-v1', degraded: false, sources: [source],
        })
        const prepareRetrievedKnowledge = vi.fn(async () => retrievedKnowledge)
        const assertRetrievedKnowledgeCurrent = vi.fn(async () => {})
        const delegate = createFakeAgentProvider()
        const received: Array<Parameters<AgentProvider['reviewKnowledge']>[0]> = []
        const provider: AgentProvider = {
          ...delegate, executorKind,
          async reviewKnowledge(input) {
            received.push(input)
            return delegate.reviewKnowledge(input)
          },
        }
        const runtime = createKnowledgeReviewRuntime({
          store, knowledgeDocuments, knowledgeChunks, knowledgeRoot: 'docs/knowledge',
          prepareRetrievedKnowledge, assertRetrievedKnowledgeCurrent,
          resolveProviderMetadata: async () => provider, resolveProvider: async () => provider,
        })

        const result = await runtime.run({ ...reviewInput(provider.id), nodeId: reviewNode.id })

        expect(received).toHaveLength(1)
        const actual = received[0]!
        expect(actual.request.nodeId).toBe(reviewNode.id)
        expect(actual.context.node).toMatchObject({ id: reviewNode.id, stage, kind: reviewNode.kind })
        expect(actual.prompt).toContain(source.content)
        expect(actual.prompt).toContain(source.path)
        expect(actual.prompt).toContain(source.contentDigest)
        expect(actual.prompt).toContain('untrusted')
        expect(actual.prompt).not.toContain('six-stage-generation')
        expect(actual.context.manifest.knowledgeContext?.retrievedKnowledge).toEqual(retrievedKnowledge.manifest)
        expect(actual.context.subjectArtifacts.map((artifact) => artifact.id)).toEqual(
          stage === 'design' ? ['art-clarify', 'art-design'] : reviewNode.artifactIds,
        )
        expect(prepareRetrievedKnowledge).toHaveBeenCalledOnce()
        expect(prepareRetrievedKnowledge).toHaveBeenCalledWith(expect.objectContaining({
          stage, projectId: reviewRun.projectId, userId: 'u-ling',
          query: expect.stringContaining(reviewRun.request),
        }))
        expect(assertRetrievedKnowledgeCurrent).toHaveBeenCalledWith(actual.context.manifest.knowledgeContext!.retrievedKnowledge)
        expect(result.review.contextManifest).toEqual(actual.context.manifest)
        expect(result.review.executorKind ?? 'direct-provider').toBe(executorKind)
        expect(store.reviews).toEqual([result.review])
        expect(store.savedArtifacts).toHaveLength(1)
        expect(store.traces).toHaveLength(1)
        expect(store.tokenUsage).toHaveLength(1)
        expect(reviewRun).toEqual(before)
      },
    )
  })

  it.each(['build', 'test'] as const)('keeps the default %s execution node out of the Gate Review API', async (stage) => {
    const run = structuredClone(fixtureRun)
    const node = run.nodes.find((candidate) => candidate.stage === stage)!
    run.currentNodeId = node.id
    node.status = 'running'
    const store = new MemoryKnowledgeReviewStore()
    vi.spyOn(store, 'listRuns').mockResolvedValue([run])
    const provider = createFakeAgentProvider()
    const reviewKnowledge = vi.spyOn(provider, 'reviewKnowledge')
    const prepareRetrievedKnowledge = vi.fn(async () => undefined)
    const runtime = createKnowledgeReviewRuntime({
      store, knowledgeDocuments, knowledgeChunks, prepareRetrievedKnowledge,
      resolveProviderMetadata: async () => provider, resolveProvider: async () => provider,
    })
    await expect(runtime.run({ ...reviewInput(provider.id), nodeId: node.id })).rejects.toThrow('当前 Gate')
    expect(prepareRetrievedKnowledge).not.toHaveBeenCalled()
    expect(reviewKnowledge).not.toHaveBeenCalled()
    expect(store.reviews).toHaveLength(0)
  })

  it.each(['current', 'before_dispatch', 'after_dispatch'] as const)('binds retrieved source checks around review dispatch: %s', async (scenario) => {
    const store = new MemoryKnowledgeReviewStore()
    const retrievedKnowledge = assembleRetrievedKnowledgeContext({
      stage: 'design', scope: { projectId: fixtureRun.projectId, userId: 'u-ling' },
      queryDigest: `sha256:${'b'.repeat(64)}`, configGeneration: 'generation-1', degraded: false,
      sources: [{ sourceRef: 'cleanup-v1', path: 'docs/knowledge/cleanup.md', title: 'Cleanup',
        contentDigest: `sha256:${'a'.repeat(64)}`, matchReason: 'semantic',
        content: 'Only completed tasks older than seven days can be removed.' }],
    })
    const prepareRetrievedKnowledge = vi.fn(async () => retrievedKnowledge)
    let sent = false
    const delegate = createFakeAgentProvider()
    const reviewKnowledge = vi.fn(async (input: Parameters<AgentProvider['reviewKnowledge']>[0]) => {
      sent = true
      expect(input.prompt).toContain('Only completed tasks older than seven days can be removed.')
      expect(input.context.manifest.knowledgeContext?.retrievedKnowledge).toEqual(retrievedKnowledge.manifest)
      return delegate.reviewKnowledge(input)
    })
    const provider: AgentProvider = { ...delegate, reviewKnowledge }
    const assertRetrievedKnowledgeCurrent = vi.fn(async () => {
      if (scenario === 'before_dispatch' || scenario === 'after_dispatch' && sent) {
        throw new Error('Retrieved knowledge source changed')
      }
    })
    const runtime = createKnowledgeReviewRuntime({
      store, knowledgeDocuments, knowledgeChunks, prepareRetrievedKnowledge, assertRetrievedKnowledgeCurrent,
      resolveProviderMetadata: async () => provider, resolveProvider: async () => provider,
    })
    if (scenario === 'current') {
      const result = await runtime.run(reviewInput(provider.id))
      expect(result.review.contextManifest?.knowledgeContext?.retrievedKnowledge).toEqual(retrievedKnowledge.manifest)
      expect(store.reviews).toHaveLength(1)
    } else {
      await expect(runtime.run(reviewInput(provider.id))).rejects.toThrow('Retrieved knowledge source changed')
      expect(store.reviews).toHaveLength(0)
      expect(store.savedArtifacts).toHaveLength(0)
    }
    expect(prepareRetrievedKnowledge).toHaveBeenCalledOnce()
    expect(prepareRetrievedKnowledge).toHaveBeenCalledWith(expect.objectContaining({
      projectId: fixtureRun.projectId, userId: 'u-ling', stage: 'design',
      query: expect.stringContaining(fixtureRun.request),
    }))
    expect(reviewKnowledge).toHaveBeenCalledTimes(scenario === 'before_dispatch' ? 0 : 1)
    expect(store.tokenUsage).toHaveLength(scenario === 'before_dispatch' ? 0 : 1)
    expect(assertRetrievedKnowledgeCurrent).toHaveBeenCalledWith(retrievedKnowledge.manifest)
  })

  it('persists safe local-agent failure diagnostics without publishing a review or advancing the Gate', async () => {
    const store = new MemoryKnowledgeReviewStore()
    const details = stageAgentFailureDetails('provider_rate_limit', 'provider', { httpStatus: 429, cleanupFailures: ['process_stop'] })
    const provider: AgentProvider = { ...createFakeAgentProvider(), executorKind: 'local-agent', reviewKnowledge: async () => {
      throw new AgentProviderRequestError({ code: 'http_429', sanitizedCause: 'local_agent_provider_rate_limit',
        deliveryState: 'response_received', billingState: 'unknown', retryable: false,
        failureDetails: details, usage: { inputTokens: 10, outputTokens: 5, budgetAttemptIds: ['prior-call'] } })
    } }
    const runtime = createKnowledgeReviewRuntime({ store, knowledgeDocuments, knowledgeChunks,
      resolveProviderMetadata: async () => provider, resolveProvider: async () => provider })
    const before = await store.listRuns()
    await expect(runtime.run(reviewInput(provider.id))).rejects.toThrow('模型服务限流')
    expect(store.traces[0]?.failureDetails).toEqual(details)
    expect(store.reviews).toEqual([])
    expect(await store.listRuns()).toEqual(before)
    expect(store.tokenUsage[0]).toMatchObject({ inputTokens: 10, outputTokens: 5, budgetAttemptIds: ['prior-call'] })
  })

  it('reviews the current PR package without advancing delivery', async () => {
    const prRun = structuredClone(fixtureRun)
    const pr = prRun.nodes.find((candidate) => candidate.kind === 'pr')!
    prRun.currentNodeId = pr.id
    pr.status = 'running'
    pr.artifactIds = ['pr-package']
    const store = new MemoryKnowledgeReviewStore([{
      id: 'pr-package', runId: prRun.id, nodeId: pr.id, kind: 'pr',
      title: 'PR package', summary: 'Ready for delivery review',
      content: 'Reviewed diff and passed tests, awaiting Web delivery approval.',
      redacted: true, updatedAt: '2026-10-04T12:00:00.000Z',
    }])
    vi.spyOn(store, 'listRuns').mockResolvedValue([prRun])
    const before = structuredClone(prRun)
    const provider = createFakeAgentProvider()
    const reviewKnowledge = vi.spyOn(provider, 'reviewKnowledge')
    const runtime = createKnowledgeReviewRuntime({
      store, knowledgeDocuments, knowledgeChunks,
      resolveProviderMetadata: async () => provider, resolveProvider: async () => provider,
    })
    const input = { ...reviewInput(provider.id), nodeId: pr.id }

    const result = await runtime.run(input)
    expect(result.review.nodeId).toBe(pr.id)
    expect(result.review.contextManifest?.stage).toBe('pr')
    expect(reviewKnowledge.mock.calls[0]![0].prompt).toContain('PR delivery package')
    expect(prRun).toEqual(before)
    expect(store.reviews).toHaveLength(1)

    pr.status = 'success'
    await expect(runtime.run({ ...input, previousReviewId: result.review.id })).rejects.toThrow('当前')
    pr.status = 'running'
    prRun.currentNodeId = fixtureRun.currentNodeId
    await expect(runtime.run(input)).rejects.toThrow('当前')
    expect(reviewKnowledge).toHaveBeenCalledTimes(1)
  })

  it('shares the Gate execution guard across per-request runtimes for the same store', async () => {
    const store = new MemoryKnowledgeReviewStore()
    const provider = createFakeAgentProvider()
    const reviewKnowledge = vi.spyOn(provider, 'reviewKnowledge')
    const createRuntime = () => createKnowledgeReviewRuntime({
      store, knowledgeDocuments, knowledgeChunks,
      resolveProviderMetadata: async () => provider,
      resolveProvider: async () => provider,
    })
    const results = await Promise.allSettled([
      createRuntime().run(reviewInput(provider.id)),
      createRuntime().run(reviewInput(provider.id)),
    ])
    expect(reviewKnowledge).toHaveBeenCalledTimes(1)
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(store.reviews).toHaveLength(1)
  })

  it.each([false, true])('requires confirmation and rejects replay, including changed review content (%s)', async (contentChanged) => {
    const subjectArtifacts = structuredClone(artifacts)
    const store = new MemoryKnowledgeReviewStore(subjectArtifacts)
    const provider = createFakeAgentProvider()
    const reviewKnowledge = vi.spyOn(provider, 'reviewKnowledge')
    const createRuntime = () => createKnowledgeReviewRuntime({
      store, knowledgeDocuments, knowledgeChunks,
      resolveProviderMetadata: async () => provider,
      resolveProvider: async () => provider,
    })
    const first = await createRuntime().run(reviewInput(provider.id))
    if (contentChanged) {
      const design = subjectArtifacts.find((artifact) => artifact.id === 'art-design')!
      design.content += '\n\nRevised acceptance: preserve all unrelated README content.'
    }
    await expect(createRuntime().run(reviewInput(provider.id))).rejects.toThrow('重新审查需要确认')
    expect(reviewKnowledge).toHaveBeenCalledTimes(1)
    const confirmedInput = { ...reviewInput(provider.id), previousReviewId: first.review.id }
    await createRuntime().run(confirmedInput)
    expect(reviewKnowledge).toHaveBeenCalledTimes(2)
    await expect(createRuntime().run(confirmedInput)).rejects.toThrow('审查记录已更新')
    expect(reviewKnowledge).toHaveBeenCalledTimes(2)
    expect(store.reviews).toHaveLength(2)
  })

  it('refuses a resolved provider whose execution mode differs from the confirmed one (knowledge-context K2)', async () => {
    const store = new MemoryKnowledgeReviewStore()
    const direct = createFakeAgentProvider()
    const reviewKnowledge = vi.spyOn(direct, 'reviewKnowledge')
    const local: AgentProvider = { ...direct, executorKind: 'local-agent' }
    const mismatched = createKnowledgeReviewRuntime({
      store, knowledgeDocuments, knowledgeChunks,
      resolveProviderMetadata: async () => local,
      resolveProvider: async () => direct,
    })
    await expect(mismatched.run(reviewInput(direct.id))).rejects.toThrow()
    expect(reviewKnowledge).not.toHaveBeenCalled()
    expect(store.reviews).toHaveLength(0)

    const matching = createKnowledgeReviewRuntime({
      store, knowledgeDocuments, knowledgeChunks,
      resolveProviderMetadata: async () => local,
      resolveProvider: async () => local,
    })
    const result = await matching.run(reviewInput(direct.id))
    expect(result.review.executorKind).toBe('local-agent')
    expect(store.reviews[0]?.executorKind).toBe('local-agent')
  })

  it('retains the saved result after a confirmed rerun fails and permits its confirmed retry', async () => {
    const store = new MemoryKnowledgeReviewStore()
    const provider = createFakeAgentProvider()
    const reviewKnowledge = vi.spyOn(provider, 'reviewKnowledge')
    const runtime = createKnowledgeReviewRuntime({
      store, knowledgeDocuments, knowledgeChunks,
      resolveProviderMetadata: async () => provider,
      resolveProvider: async () => provider,
    })
    const first = await runtime.run(reviewInput(provider.id))
    const confirmedInput = { ...reviewInput(provider.id), previousReviewId: first.review.id }
    reviewKnowledge.mockRejectedValueOnce(new Error('Provider unavailable'))
    await expect(runtime.run(confirmedInput)).rejects.toThrow('Provider unavailable')
    expect(store.reviews).toEqual([first.review])
    await expect(runtime.run(confirmedInput)).resolves.toMatchObject({ review: { providerId: provider.id } })
    expect(reviewKnowledge).toHaveBeenCalledTimes(3)
    expect(store.reviews).toHaveLength(2)
  })

  it('calls the provider and persists a review only once for concurrent requests for the same Gate', async () => {
    const store = new MemoryKnowledgeReviewStore()
    const provider = createFakeAgentProvider()
    const reviewKnowledge = vi.spyOn(provider, 'reviewKnowledge')
    let requestSequence = 0
    const runtime = createKnowledgeReviewRuntime({
      store,
      knowledgeDocuments,
      knowledgeChunks,
      resolveProviderMetadata: async () => ({ id: provider.id, name: provider.name, model: provider.model }),
      resolveProvider: async () => provider,
      createRequestId: () => `concurrent-review-${++requestSequence}`,
    })

    const results = await Promise.allSettled([
      runtime.run(reviewInput(provider.id)),
      runtime.run(reviewInput(provider.id)),
    ])

    expect(reviewKnowledge).toHaveBeenCalledTimes(1)
    expect(store.reviews).toHaveLength(1)
    expect(store.savedArtifacts).toHaveLength(1)
    expect(store.tokenUsage).toHaveLength(1)
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })

  it.each([false, true])('keeps reports and Gate unchanged after malformed billed output, then allows a budgeted retry (existing report: %s)', async (hasReport) => {
    const store = new MemoryKnowledgeReviewStore()
    const valid = JSON.stringify({
      conclusion: '建议通过', summary: '完整结论', risks: [], missingEvidence: [],
      suggestedTests: [], confidence: 0.8,
    })
    const invalid = '{"summary":"private response text",}'
    let content = valid
    const fetcher = vi.fn(async () => Response.json({
      choices: [{ finish_reason: 'stop', message: { content, reasoning_content: 'private reasoning' } }],
      usage: { prompt_tokens: 99, completion_tokens: 123 },
    }))
    const provider = createOpenAiCompatibleAgentProvider({
      model: 'gpt-4.1-mini', apiKey: 'fixture-key', baseUrl: 'http://127.0.0.1:9/v1', fetcher,
    })
    const budgetGuard = vi.fn(async () => ({
      status: 'allowed' as const, blocksRun: false, currentSpendUsd: 0,
      projectedCostUsd: 0.01, limitUsd: 1, reason: 'Within fixture budget.',
    }))
    let sequence = 0
    const runtime = createKnowledgeReviewRuntime({
      store, knowledgeDocuments, knowledgeChunks, budgetGuard,
      resolveProviderMetadata: async () => provider,
      resolveProvider: async () => provider,
      createRequestId: () => `json-review-${++sequence}`,
    })
    const first = hasReport ? await runtime.run(reviewInput(provider.id)) : undefined
    const request = {
      ...reviewInput(provider.id), ...(first ? { previousReviewId: first.review.id } : {}),
    }
    const before = structuredClone({
      runs: await store.listRuns(), reviews: store.reviews,
      artifacts: store.savedArtifacts, traces: store.traces,
    })
    content = invalid

    await expect(runtime.run(request)).rejects.toThrow('模型返回的正文格式有误，无法解析，未保存本次报告。')
    expect({
      runs: await store.listRuns(), reviews: store.reviews,
      artifacts: store.savedArtifacts, traces: store.traces,
    }).toEqual(before)
    const diagnostic = store.events.find((event) => event.kind === 'error')!.message
    expect(diagnostic).toContain('"cause":"invalid_json"')
    expect(diagnostic).toContain('"finishReason":"stop"')
    expect(diagnostic).toContain(`"contentLength":${invalid.length}`)
    expect(diagnostic).toContain('"billingState":"confirmed"')
    expect(diagnostic).not.toMatch(/private response text|private reasoning|fixture-key/)
    const priorCalls = hasReport ? 1 : 0
    expect(fetcher).toHaveBeenCalledTimes(priorCalls + 3)
    expect(store.tokenUsage).toHaveLength(priorCalls + 3)
    expect(store.tokenUsage.at(-1)).toMatchObject({ inputTokens: 99, outputTokens: 123, usageStatus: 'complete' })

    content = valid
    await expect(runtime.run(request)).resolves.toMatchObject({ review: { summary: '完整结论' } })
    expect(fetcher).toHaveBeenCalledTimes(priorCalls + 4)
    expect(budgetGuard).toHaveBeenCalledTimes(priorCalls + 2)
    expect(store.tokenUsage).toHaveLength(priorCalls + 4)
    expect(new Set(store.tokenUsage.map((usage) => usage.id)).size).toBe(priorCalls + 4)
    expect(store.reviews).toHaveLength(priorCalls + 1)
    expect(store.savedArtifacts).toHaveLength(priorCalls + 1)
    expect(await store.listRuns()).toEqual(before.runs)
  })

  it('releases the current-Gate execution guard after provider failure so a retry can succeed', async () => {
    const store = new MemoryKnowledgeReviewStore()
    const provider = createFakeAgentProvider()
    const reviewKnowledge = vi.spyOn(provider, 'reviewKnowledge').mockRejectedValueOnce(new Error('Provider unavailable'))
    let requestSequence = 0
    const runtime = createKnowledgeReviewRuntime({
      store,
      knowledgeDocuments,
      knowledgeChunks,
      resolveProviderMetadata: async () => ({ id: provider.id, name: provider.name, model: provider.model }),
      resolveProvider: async () => provider,
      createRequestId: () => `retry-review-${++requestSequence}`,
    })

    await expect(runtime.run(reviewInput(provider.id))).rejects.toThrow('Provider unavailable')
    await expect(runtime.run(reviewInput(provider.id))).resolves.toMatchObject({ review: { providerId: provider.id } })

    expect(reviewKnowledge).toHaveBeenCalledTimes(2)
    expect(store.reviews).toHaveLength(1)
    expect(store.events.filter((event) => event.kind === 'error')).toHaveLength(2)
    expect(store.events.filter((event) => event.kind === 'agent_review')).toHaveLength(1)
  })

  it('fails closed for a paid provider when no budget guard is configured', async () => {
    const store = new MemoryKnowledgeReviewStore()
    const resolveProvider = vi.fn()
    const runtime = createKnowledgeReviewRuntime({
      store,
      knowledgeDocuments,
      knowledgeChunks,
      resolveProviderMetadata: vi.fn(async () => ({
        id: 'team-openai',
        name: 'Team OpenAI',
        model: 'gpt-4.1-mini',
      })),
      resolveProvider,
      now: () => '2026-07-31T11:59:00.000Z',
      createRequestId: () => 'review-request-no-guard',
    })

    await expect(runtime.run(reviewInput('team-openai'))).rejects.toThrow(
      /尚未调用模型：预算检查未就绪/i,
    )

    expect(resolveProvider).not.toHaveBeenCalled()
    expect(store.events).toEqual([
      expect.objectContaining({ kind: 'error', message: expect.stringContaining('unavailable') }),
    ])
    expect(store.savedArtifacts).toEqual([])
    expect(store.reviews).toEqual([])
    expect(store.traces).toEqual([])
    expect(store.tokenUsage).toEqual([])
  })

  it('persists one redacted local error and never resolves the paid provider when budget blocks', async () => {
    const store = new MemoryKnowledgeReviewStore()
    const resolveProvider = vi.fn(async (): Promise<AgentProvider> => {
      throw new Error('provider resolution must happen after budget authorization')
    })
    const budgetGuard = vi.fn(async () => {
      expect(resolveProvider).not.toHaveBeenCalled()
      return {
        status: 'unavailable' as const,
        blocksRun: true,
        currentSpendUsd: 0,
        projectedCostUsd: 0.01,
        reason: 'Budget service failed with OPENAI_API_KEY=sk-private-key.',
      }
    })
    const runtime = createKnowledgeReviewRuntime({
      store,
      knowledgeDocuments,
      knowledgeChunks,
      resolveProviderMetadata: vi.fn(async () => ({
        id: 'team-openai',
        name: 'Team OpenAI',
        model: 'gpt-4.1-mini',
      })),
      resolveProvider,
      budgetGuard,
      now: () => '2026-07-31T12:00:00.000Z',
      createRequestId: () => 'review-request-budget-blocked',
    })

    await expect(runtime.run({
      runId: fixtureRun.id,
      nodeId: fixtureRun.currentNodeId,
      projectId: fixtureRun.projectId,
      requestedBy: 'u-ling',
      runtime: 'electron',
      providerId: 'team-openai',
      runtimeBudgetApprovalId: 'approval-knowledge-1',
    })).rejects.toThrow(/尚未调用模型：预算检查未就绪.*Budget service failed/i)

    expect(budgetGuard).toHaveBeenCalledWith(expect.objectContaining({
      projectId: fixtureRun.projectId,
      providerId: 'team-openai',
      requestedBy: 'u-ling',
      projectedCostUsd: expect.any(Number),
      approvalId: 'approval-knowledge-1',
    }))
    expect(resolveProvider).not.toHaveBeenCalled()
    expect(store.events).toEqual([
      expect.objectContaining({
        runId: fixtureRun.id,
        nodeId: fixtureRun.currentNodeId,
        sequence: 1,
        kind: 'error',
        message: expect.stringContaining('[REDACTED'),
      }),
    ])
    expect(JSON.stringify(store.events)).not.toContain('sk-private-key')
    expect(store.savedArtifacts).toEqual([])
    expect(store.reviews).toEqual([])
    expect(store.traces).toEqual([])
    expect(store.tokenUsage).toEqual([])
  })

  it('persists the completed fake Review bundle without directly uploading a summary', async () => {
    const store = new MemoryKnowledgeReviewStore()
    const provider = createFakeAgentProvider()
    const reviewKnowledge = vi.spyOn(provider, 'reviewKnowledge')
    const budgetGuard = vi.fn()
    const runtimeDependencies = {
      store,
      knowledgeDocuments,
      knowledgeChunks,
      resolveProviderMetadata: vi.fn(async () => ({
        id: 'fake-knowledge-review',
        name: 'Deterministic Fake Provider',
        model: 'fake',
      })),
      resolveProvider: vi.fn(async () => provider),
      budgetGuard,
      now: () => '2026-07-31T12:01:00.000Z',
      createRequestId: () => 'review-request-fake',
    }
    const runtime = createKnowledgeReviewRuntime(runtimeDependencies)

    const result = await runtime.run(reviewInput('fake-knowledge-review'))

    expect(budgetGuard).not.toHaveBeenCalled()
    expect(reviewKnowledge).toHaveBeenCalledTimes(1)
    expect(result.review.providerId).toBe('fake-knowledge-review')
    expect(store.savedArtifacts).toEqual([expect.objectContaining({ kind: 'agent_review' })])
    expect(store.events).toEqual([expect.objectContaining({ kind: 'agent_review' })])
    expect(store.reviews).toHaveLength(1)
    expect(store.traces).toHaveLength(1)
    expect(store.tokenUsage).toHaveLength(1)
  })

  it('projects global testing policy as supplemental evidence during design review', async () => {
    const organizationPolicy = createRecommendedEnforcementPreset({
      organizationId: 'org-demo',
      updatedAt: '2026-07-31T12:01:10.000Z',
    })
    const snapshot: PolicySnapshot = {
      projectId: 'paired-team-project',
      organizationPolicy,
      projectOverride: null,
      effectivePolicy: resolveEffectivePolicy(organizationPolicy, null),
      version: organizationPolicy.version,
      updatedAt: organizationPolicy.updatedAt,
      syncedAt: organizationPolicy.updatedAt,
      source: 'remote_cache',
    }
    const store = new MemoryKnowledgeReviewStore()
    const loadPolicySnapshot = vi.fn(async () => snapshot)
    const rawPolicyLookup = vi.spyOn(store, 'getPolicySnapshot')
    const provider = createFakeAgentProvider()
    const reviewKnowledge = vi.spyOn(provider, 'reviewKnowledge')
    const runtime = createKnowledgeReviewRuntime({
      store,
      loadPolicySnapshot,
      knowledgeDocuments,
      knowledgeChunks,
      resolveProviderMetadata: vi.fn(async () => ({
        id: provider.id,
        name: provider.name,
        model: provider.model,
      })),
      resolveProvider: vi.fn(async () => provider),
      now: () => '2026-07-31T12:01:15.000Z',
      createRequestId: () => 'review-request-policy-projection',
    })

    const result = await runtime.run(reviewInput(provider.id))
    const providerInput = reviewKnowledge.mock.calls[0]![0]

    expect(loadPolicySnapshot).toHaveBeenCalledWith(fixtureRun.projectId)
    expect(rawPolicyLookup).not.toHaveBeenCalled()
    expect(providerInput.context.policy).toMatchObject({ version: snapshot.version, source: 'remote_cache' })
    expect(providerInput.prompt).toContain('effectivePolicy')
    expect(providerInput.context.testEvidence).toEqual([])
    expect(providerInput.context.manifest.fieldProjection?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'test_evidence',
          applicability: 'optional',
          state: 'optional',
          includeInProviderPrompt: false,
        }),
      ]),
    )
    expect(providerInput.prompt).not.toContain('supplementalTestEvidence')
    expect(result.review.missingEvidence).not.toContain(
      'Attach passing local test evidence required for this workflow stage before final approval.',
    )
  })

  it('records Electron as the trusted runtime instead of renderer-supplied provenance', async () => {
    const store = new MemoryKnowledgeReviewStore()
    const provider = createFakeAgentProvider()
    const runtime = createKnowledgeReviewRuntime({
      store,
      knowledgeDocuments,
      knowledgeChunks,
      resolveProviderMetadata: vi.fn(async () => ({
        id: provider.id,
        name: provider.name,
        model: provider.model,
      })),
      resolveProvider: vi.fn(async () => provider),
      now: () => '2026-07-31T12:01:30.000Z',
      createRequestId: () => 'review-request-trusted-runtime',
    })

    const result = await runtime.run({ ...reviewInput(provider.id), runtime: 'api' })

    expect(result.review.runtime).toBe('electron')
  })

  it('fails closed with an auditable error when the exact linked Design Artifact is missing', async () => {
    const store = new MemoryKnowledgeReviewStore(
      artifacts.filter((artifact) => artifact.id !== 'art-design'),
    )
    const provider = createFakeAgentProvider()
    const reviewKnowledge = vi.spyOn(provider, 'reviewKnowledge')
    const runtime = createKnowledgeReviewRuntime({
      store,
      knowledgeDocuments,
      knowledgeChunks,
      resolveProviderMetadata: vi.fn(async () => ({
        id: provider.id,
        name: provider.name,
        model: provider.model,
      })),
      resolveProvider: vi.fn(async () => provider),
      now: () => '2026-07-31T12:01:45.000Z',
      createRequestId: () => 'review-request-missing-subject',
    })

    await expect(runtime.run(reviewInput(provider.id))).rejects.toThrow(
      /linked Artifact art-design is missing/i,
    )
    expect(reviewKnowledge).not.toHaveBeenCalled()
    expect(store.events).toEqual([
      expect.objectContaining({
        kind: 'error',
        message: expect.stringContaining('门禁审查对象不完整'),
      }),
    ])
    expect(store.reviews).toEqual([])
  })

  it('resolves and calls a paid provider exactly once only after the budget guard allows it', async () => {
    const store = new MemoryKnowledgeReviewStore()
    const order: string[] = []
    const reviewKnowledge = vi.fn(async (_input: Parameters<AgentProvider['reviewKnowledge']>[0]) => {
      order.push('provider-call')
      return {
        model: 'gpt-4.1-mini',
        conclusion: 'ready',
        summary: 'Budget-authorized Knowledge Review.',
        risks: [],
        missingEvidence: [],
        suggestedTests: ['Run focused tests.'],
        confidence: 0.91,
      }
    })
    const resolveProvider = vi.fn(async (): Promise<AgentProvider> => {
      order.push('resolve-secret')
      return {
        id: 'team-openai',
        name: 'Team OpenAI',
        model: 'gpt-4.1-mini',
        reviewKnowledge,
      }
    })
    const budgetGuard = vi.fn(async () => {
      order.push('budget')
      expect(resolveProvider).not.toHaveBeenCalled()
      return {
        status: 'allowed' as const,
        blocksRun: false,
        currentSpendUsd: 1,
        projectedCostUsd: 0.01,
        limitUsd: 20,
        reason: 'Within budget.',
      }
    })
    const runtime = createKnowledgeReviewRuntime({
      store,
      knowledgeDocuments,
      knowledgeChunks,
      resolveProviderMetadata: vi.fn(async () => {
        order.push('metadata')
        return {
          id: 'team-openai',
          name: 'Team OpenAI',
          model: 'gpt-4.1-mini',
        }
      }),
      resolveProvider,
      budgetGuard,
      now: () => '2026-07-31T12:02:00.000Z',
      createRequestId: () => 'review-request-paid',
    })

    const result = await runtime.run(reviewInput('team-openai'))

    expect(order).toEqual(['metadata', 'budget', 'resolve-secret', 'provider-call'])
    expect(resolveProvider).toHaveBeenCalledTimes(1)
    expect(reviewKnowledge).toHaveBeenCalledTimes(1)
    const providerInput = reviewKnowledge.mock.calls[0]![0]
    expect(providerInput.prompt).toContain(fixtureRun.request)
    expect(providerInput.prompt).toContain(
      artifacts.find((artifact) => artifact.id === 'art-clarify')!.content,
    )
    expect(providerInput.prompt).toContain(
      artifacts.find((artifact) => artifact.id === 'art-design')!.content,
    )
    expect(providerInput.prompt).toContain('CONTEXT_APPLICABILITY')
    expect(providerInput.prompt).not.toContain('SUPPLEMENTAL_TEST_EVIDENCE')
    expect(providerInput.context.manifest.fieldProjection?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'test_evidence',
          state: 'optional',
          includeInProviderPrompt: false,
        }),
        expect.objectContaining({
          field: 'agent_review',
          applicability: 'not_applicable',
        }),
      ]),
    )
    expect(providerInput.context.manifest.subjectArtifacts.map((artifact) => artifact.id)).toEqual([
      'art-clarify',
      'art-design',
    ])
    expect(result.review.summary).toBe('Budget-authorized Knowledge Review.')
    expect(result.review.contextManifest).toEqual(providerInput.context.manifest)
    expect(store.savedArtifacts).toEqual([expect.objectContaining({ kind: 'agent_review' })])
    expect(store.reviews).toHaveLength(1)
    expect(store.traces).toHaveLength(1)
    expect(store.tokenUsage).toHaveLength(1)
  })
})

const fixtureRun = structuredClone(runs[0]!)

/**
 * Clarify/design/PR/acceptance use their existing template review nodes. Build and test
 * demonstrate an explicit Gate in those stages, not a disguised default task/test node.
 */
function stageReviewFixture(stage: NodeStage) {
  const run = structuredClone(fixtureRun)
  const existing = run.nodes.find((node) => node.stage === stage &&
    (stage === 'clarify' || stage === 'design' ? node.kind === 'gate' : true))!
  const node = stage === 'build' || stage === 'test'
    ? { ...existing, id: `${existing.id}-review-gate`, title: `${stage} review Gate`,
        kind: 'gate' as const, requiredRole: 'lead' as const, status: 'running' as const }
    : existing
  if (stage === 'build' || stage === 'test') {
    existing.status = 'success'
    run.nodes.push(node)
    run.edges.push({ id: `edge-${stage}-review`, source: existing.id, target: node.id, kind: 'gate' })
  }
  run.currentNodeId = node.id
  node.status = 'running'
  run.status = 'paused_at_gate'
  const stages: NodeStage[] = ['clarify', 'design', 'build', 'test', 'pr', 'accept']
  for (const previous of run.nodes) {
    if (stages.indexOf(previous.stage) < stages.indexOf(stage)) previous.status = 'success'
  }
  return { run, node }
}

function reviewInput(providerId: string) {
  return {
    runId: fixtureRun.id,
    nodeId: fixtureRun.currentNodeId,
    projectId: fixtureRun.projectId,
    requestedBy: 'u-ling',
    runtime: 'electron' as const,
    providerId,
  }
}

class MemoryKnowledgeReviewStore implements KnowledgeReviewRuntimeStore {
  readonly events: AgentEvent[] = []
  readonly savedArtifacts: Artifact[] = []
  readonly reviews: AgentReviewResult[] = []
  readonly traces: AgentTrace[] = []
  readonly tokenUsage: AgentTokenUsage[] = []

  constructor(
    private readonly artifactFixtures: Artifact[] = artifacts,
    private readonly policySnapshot: PolicySnapshot | null = null,
  ) {}

  async listRuns(): Promise<WorkflowRun[]> {
    return [fixtureRun]
  }

  async listArtifacts(runId?: string): Promise<Artifact[]> {
    return this.artifactFixtures.filter((artifact) => !runId || artifact.runId === runId)
  }

  async listTestEvidence(): Promise<TestEvidence[]> {
    return []
  }

  async listEvents(runId?: string): Promise<AgentEvent[]> {
    return this.events.filter((event) => !runId || event.runId === runId)
  }

  async listAgentReviews(runId?: string): Promise<AgentReviewResult[]> {
    return this.reviews.filter((review) => !runId || review.runId === runId).reverse()
  }

  async getPolicySnapshot(): Promise<PolicySnapshot | null> {
    return this.policySnapshot
  }

  async saveArtifact(artifact: Artifact): Promise<void> {
    this.savedArtifacts.push(artifact)
  }

  async saveEvent(event: AgentEvent): Promise<void> {
    this.events.push(event)
  }

  async saveAgentReview(review: AgentReviewResult): Promise<void> {
    this.reviews.push(review)
  }

  async saveAgentTrace(trace: AgentTrace): Promise<void> {
    this.traces.push(trace)
  }

  async saveAgentTokenUsage(usage: AgentTokenUsage): Promise<void> {
    this.tokenUsage.push(usage)
  }

  async loadState(): Promise<LocalExecutionState> {
    return {} as LocalExecutionState
  }
}

const reviewMemoryTime = '2026-10-22T12:00:00.000Z'
/** A review store whose project memory (ADR 0030) is on; editing or clearing it makes a recall stale. */
class MemoryEnabledReviewStore extends MemoryKnowledgeReviewStore {
  pairing: DesktopPairingCredential | null = null
  changed = false
  readonly memory = projectMemoryIdentity({ id: 'private-review-memory' },
    `[observation] ${fixtureRun.request} · MEMORY_EXPERIENCE: check the known serialization issue before investigating a regression.`)
  constructor() {
    super()
    registerProjectMemoryRecall(this, {
      recall: async () => ({ items: [this.memory], degraded: false }),
      assertCurrent: async () => { if (this.changed) throw new Error('Project memory was edited or deleted') },
    })
  }
  async getDesktopPairingCredential() { return this.pairing }
}
