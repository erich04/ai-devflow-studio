import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AgentProviderRequestError,
  buildAgentReviewContext,
  runKnowledgeReviewAgent,
  StageAgentExecutionError,
  describeAgentProviderFailure,
  type AgentProviderUsage,
} from '@ai-devflow/shared'
import { artifacts, knowledgeChunks, knowledgeDocuments, runs } from '@ai-devflow/shared/fixtures'
import {
  createReadOnlyLocalKnowledgeReviewProvider,
  type LocalAgentReviewBudgetRelay,
} from './knowledge-review-local-agent'
import type { ReadOnlyStageAgentRunner } from './stage-agent-executor'
import { OpencodeHttpRequestError, OpencodeMessageResponseError, sendOpencodeMessage } from './opencode-http-adapter'
import { createGovernedOpencodeProxy } from './governed-opencode-proxy'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const routeSource = 'export function health() {\n  return { status: "ok" }\n}\n'

async function repository() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'devflow-review-agent-')))
  roots.push(root)
  await writeFile(path.join(root, 'health.ts'), routeSource)
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['add', 'health.ts'], { cwd: root })
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture'], { cwd: root })
  return root
}

const reviewAnswer = {
  conclusion: '方案覆盖了健康端点的状态映射。',
  summary: '路由已经存在，方案只补降级状态。',
  risks: [],
  missingEvidence: [],
  missingEvidenceDetails: [],
  suggestedTests: ['补一条缓存超时的测试。'],
  confidence: 0.8,
}

const relayUsage: AgentProviderUsage = { inputTokens: 900, outputTokens: 120, cacheReadTokens: 0, budgetAttemptIds: ['attempt-1', 'attempt-2'], missingUsageCount: 0 }

function relay(): LocalAgentReviewBudgetRelay & { closed: boolean } {
  const state = {
    closed: false,
    binding: { providerId: 'saved-provider', modelId: 'saved-model', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'relay-token', fingerprint: 'relay' },
    usageSince: (): AgentProviderUsage | undefined => relayUsage,
    checkpoint: () => 0,
    usageAfter: (): AgentProviderUsage | undefined => relayUsage,
    failureForRequest: () => undefined,
    async close() { state.closed = true },
  }
  return state
}

function provider(root: string, runner: ReadOnlyStageAgentRunner, budgetRelay = relay()) {
  return {
    budgetRelay,
    provider: createReadOnlyLocalKnowledgeReviewProvider({
      projectId: 'project-1',
      projectPath: root,
      binaryPath: '/not-used/opencode',
      metadata: { id: 'saved-provider', name: 'OpenCode（可读仓库）· Saved', model: 'saved-model' },
      processManager: { stopProject: async () => undefined, ensure: async () => { throw new Error('not used') } },
      runtimeEnv: {},
      knowledgeRoot: 'docs/knowledge',
      openBudgetRelay: async () => budgetRelay,
      runner,
    }),
  }
}

async function reviewContext() {
  const run = runs[0]!
  const node = run.nodes.find((item) => item.id === 'n-design-gate')!
  const context = await buildAgentReviewContext({ run, node, artifacts, testEvidence: [], knowledgeDocuments, knowledgeChunks })
  return {
    context,
    request: { id: 'local-review', runId: run.id, nodeId: node.id, projectId: run.projectId, requestedBy: 'u-ling', runtime: 'electron' as const },
  }
}

function answer(value: Record<string, unknown>, extra: Partial<Awaited<ReturnType<ReadOnlyStageAgentRunner>>> = {}): ReadOnlyStageAgentRunner {
  return async () => ({
    value: { ...value, model: 'saved-model', usage: { inputTokens: 1, outputTokens: 1 } } as never,
    toolCalls: 4,
    pendingPermissionCount: 0,
    diffCount: 0,
    ...extra,
  })
}

async function expectFailure(promise: Promise<unknown>, sanitizedCause: string) {
  const error = await promise.catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(AgentProviderRequestError)
  expect(error).toMatchObject({ sanitizedCause })
  return error as AgentProviderRequestError
}

describe('read-only local Agent Gate Review (knowledge-context K2)', () => {
  it('refines a Gate budget rejection through the real relay and OpenCode adapter, without an upstream request', async () => {
    const root = await repository()
    const { context, request } = await reviewContext()
    const upstream = vi.fn(async () => new Response('{}'))
    const proxy = await createGovernedOpencodeProxy({ binding: relay().binding, projectId: 'project-1', fetcher: upstream,
      governance: { pending: async () => [], persist: async () => {}, settle: async () => {}, reserve: async () => ({
        accepted: false, decision: { status: 'unavailable', blocksRun: true, currentSpendUsd: 0, projectedCostUsd: 0, reason: 'PRIVATE_REASON' },
      }) },
    })
    try {
      const reviewProvider = createReadOnlyLocalKnowledgeReviewProvider({
        projectId: 'project-1', projectPath: root, binaryPath: 'not-used',
        metadata: { id: 'saved-provider', name: 'Saved', model: 'saved-model' }, runtimeEnv: {},
        processManager: { ensure: async () => { throw new Error('not used') }, stopProject: async () => {} },
        openBudgetRelay: async () => proxy,
        runner: async () => {
          const response = await fetch(`${proxy.binding.baseUrl}/chat/completions`, { method: 'POST',
            headers: { authorization: `Bearer ${proxy.binding.apiKey}` }, body: JSON.stringify({ model: 'saved-model' }) })
          await sendOpencodeMessage({ baseUrl: 'http://fixture', sessionId: 's', directory: root,
            model: { providerID: 'saved-provider', modelID: 'saved-model' }, text: 'x',
            fetcher: async () => new Response(JSON.stringify({ info: { error: { name: 'APIError', data: {
              statusCode: response.status, responseHeaders: Object.fromEntries(response.headers), responseBody: await response.text(),
            } } }, parts: [] })),
          })
          throw new Error('Expected adapter failure')
        },
      })
      const error = await reviewProvider.reviewKnowledge({ request, context, prompt: 'x' }).catch((error: unknown) => error)
      expect(error).toMatchObject({ failureDetails: { code: 'budget_denied', source: 'budget_relay' }, billingState: 'not_incurred', deliveryState: 'not_sent' })
      expect(describeAgentProviderFailure(error)).toContain('本轮请求尚未发送')
      expect(JSON.stringify(error)).not.toContain('PRIVATE_REASON')
      expect(upstream).not.toHaveBeenCalled()
    } finally { await proxy.close() }
  })

  it.each([
    [new OpencodeMessageResponseError({ code: 'provider_auth_error' }), 'provider_auth'],
    [new OpencodeMessageResponseError({ code: 'provider_api_error', statusCode: 429 }), 'provider_rate_limit'],
    [new OpencodeMessageResponseError({ code: 'provider_api_error', statusCode: 503 }), 'provider_unavailable'],
    [new OpencodeMessageResponseError({ code: 'context_overflow' }), 'context_limit'],
    [new OpencodeHttpRequestError({ code: 'http_status_error', statusCode: 403 }), 'runtime_http_error'],
    [new Error('PRIVATE_PROVIDER_BODY'), 'unknown_failure'],
  ])('reuses the stage classifier for %s and retains previous usage', async (cause, code) => {
    const root = await repository()
    const { context, request } = await reviewContext()
    const result = await provider(root, async () => { throw cause }).provider.reviewKnowledge({ request, context, prompt: 'x' }).catch((error: unknown) => error)
    expect(result).toMatchObject({ failureDetails: { code }, usage: { inputTokens: 900, budgetAttemptIds: ['attempt-1', 'attempt-2'] } })
    expect(describeAgentProviderFailure(result)).not.toContain('PRIVATE_PROVIDER_BODY')
    expect(JSON.stringify(result)).not.toContain('PRIVATE_PROVIDER_BODY')
  })

  it.each([false, true])('reports relay cleanup failure without replacing the primary failure (%s)', async (hasPrimary) => {
    const root = await repository()
    const { context, request } = await reviewContext()
    const budgetRelay = { ...relay(), close: async () => { throw new Error('PRIVATE_CLOSE') } }
    const runner = hasPrimary ? async () => { throw new StageAgentExecutionError('permission_denied', 'Permission requested') } : answer(reviewAnswer)
    const result = await provider(root, runner, budgetRelay).provider.reviewKnowledge({ request, context, prompt: 'x' }).catch((error: unknown) => error)
    expect(result).toMatchObject({ failureDetails: { code: hasPrimary ? 'permission_denied' : 'cleanup_failed', cleanupFailures: ['relay_close'] }, usage: { inputTokens: 900 } })
    expect(JSON.stringify(result)).not.toContain('PRIVATE_CLOSE')
  })

  it('runs the review prompt read-only, digests citations from local bytes and records a local-agent review', async () => {
    const root = await repository()
    let received: Parameters<ReadOnlyStageAgentRunner>[0] | undefined
    const runner: ReadOnlyStageAgentRunner = async (input) => {
      received = input
      return answer({
        ...reviewAnswer,
        repositoryFindings: {
          version: 1, repositoryDigest: '',
          verifiedFacts: [{ id: 'fact-1', statement: '健康端点已返回 ok。', citationIds: ['citation-1'] }],
          citations: [{ id: 'citation-1', path: 'health.ts', contentDigest: '', lineStart: 1, lineEnd: 3 }],
          assumptions: [], openQuestions: [], uncheckedScopes: [],
        },
      })(input)
    }
    const { provider: reviewProvider, budgetRelay } = provider(root, runner)
    const { context, request } = await reviewContext()

    const result = await runKnowledgeReviewAgent({ request, context, provider: reviewProvider, now: () => '2026-09-30T00:00:00.000Z' })

    expect(received?.directory).toBe(root)
    expect(received?.prompt).toContain('Use only the read, glob, grep and list tools')
    expect(received?.prompt).toContain('Project knowledge lives in docs/knowledge.')
    expect(received?.prompt).toContain('REVIEW_SUBJECT')
    expect(result.review.executorKind).toBe('local-agent')
    expect(result.review.repositoryFindings?.citations).toEqual([{
      id: 'citation-1', path: 'health.ts', lineStart: 1, lineEnd: 3,
      contentDigest: createHash('sha256').update(routeSource).digest('hex'),
    }])
    expect(result.review.repositoryFindings?.repositoryDigest).toMatch(/^[a-f0-9]{64}$/u)
    expect(result.review.gateAdvisory.blocksApproval).toBe(false)
    // Relayed usage carries the budget attempts of every OpenCode model round.
    expect(result.tokenUsage).toMatchObject({ executorKind: 'local-agent', inputTokens: 900, outputTokens: 120 })
    expect(budgetRelay.closed).toBe(true)
  })

  // #207: the relay summary carries the saved binding's billing identity and cache split.
  it('prices a DeepSeek review from the relayed rounds', async () => {
    const root = await repository()
    const deepSeekRelay = { ...relay(), usageAfter: (): AgentProviderUsage => ({
      inputTokens: 9_000, outputTokens: 1_200, cacheReadTokens: 6_000, cacheMissTokens: 3_000,
      cacheStatus: 'complete', billingProvider: 'deepseek', budgetAttemptIds: ['attempt-1', 'attempt-2'], missingUsageCount: 0,
    }) }
    const reviewProvider = createReadOnlyLocalKnowledgeReviewProvider({
      projectId: 'project-1', projectPath: root, binaryPath: '/not-used/opencode',
      metadata: { id: 'saved-provider', name: 'OpenCode（可读仓库）· DeepSeek', model: 'deepseek-flash', billingProvider: 'deepseek' },
      processManager: { stopProject: async () => undefined, ensure: async () => { throw new Error('not used') } },
      runtimeEnv: {}, openBudgetRelay: async () => deepSeekRelay,
      runner: async (input) => ({ ...(await answer(reviewAnswer)(input)), value: { ...reviewAnswer, model: 'deepseek-flash' } as never }),
    })
    const { context, request } = await reviewContext()
    const result = await runKnowledgeReviewAgent({ request, context, provider: reviewProvider, now: () => '2026-09-30T16:00:00.000Z' })
    expect(result.tokenUsage).toMatchObject({ executorKind: 'local-agent', inputTokens: 9_000, cacheReadTokens: 6_000, costStatus: 'estimated', budgetAttemptIds: ['attempt-1', 'attempt-2'] })
    expect(result.tokenUsage.costUsd).toBeGreaterThan(0)
  })

  it('accepts a review that did not need the repository', async () => {
    const root = await repository()
    const { provider: reviewProvider } = provider(root, answer(reviewAnswer))
    const { context, request } = await reviewContext()
    const result = await runKnowledgeReviewAgent({ request, context, provider: reviewProvider })
    expect(result.review.executorKind).toBe('local-agent')
    expect(result.review.repositoryFindings).toBeUndefined()
  })

  it('refuses permission requests, repository changes and citations it cannot verify', async () => {
    const root = await repository()
    const { context, request } = await reviewContext()
    const input = { request, context, prompt: 'x' }

    await expectFailure(provider(root, answer(reviewAnswer, { pendingPermissionCount: 1 })).provider.reviewKnowledge(input), 'local_agent_permission_requested')
    await expectFailure(provider(root, answer(reviewAnswer, { diffCount: 1 })).provider.reviewKnowledge(input), 'local_agent_repository_changed')
    const mutating: ReadOnlyStageAgentRunner = async (runnerInput) => {
      await writeFile(path.join(root, 'untracked.txt'), 'changed')
      return answer(reviewAnswer)(runnerInput)
    }
    await expectFailure(provider(root, mutating).provider.reviewKnowledge(input), 'local_agent_repository_changed')
    await rm(path.join(root, 'untracked.txt'))

    const citing = (citation: Record<string, unknown>) => answer({
      ...reviewAnswer,
      repositoryFindings: {
        version: 1, repositoryDigest: '',
        verifiedFacts: [{ id: 'fact-1', statement: 'x', citationIds: ['citation-1'] }],
        citations: [{ id: 'citation-1', contentDigest: '', ...citation }],
        assumptions: [], openQuestions: [], uncheckedScopes: [],
      },
    })
    await expectFailure(provider(root, citing({ path: 'missing.ts' })).provider.reviewKnowledge(input), 'local_agent_invalid_findings')
    await expectFailure(provider(root, citing({ path: '../outside.ts' })).provider.reviewKnowledge(input), 'local_agent_invalid_findings')
    await expectFailure(provider(root, citing({ path: 'health.ts', lineStart: 1, lineEnd: 99 })).provider.reviewKnowledge(input), 'local_agent_invalid_findings')
  })

  it('keeps the direct review schema and reports usage when the answer is invalid', async () => {
    const root = await repository()
    const { context, request } = await reviewContext()
    const error = await expectFailure(
      provider(root, answer({ ...reviewAnswer, confidence: 'high' })).provider.reviewKnowledge({ request, context, prompt: 'x' }),
      'invalid_review_schema',
    )
    expect(error).toMatchObject({ code: 'invalid_model_output', billingState: 'confirmed', usage: { budgetAttemptIds: ['attempt-1', 'attempt-2'] } })
  })

  it('does not start a session outside a Git repository root and bills nothing', async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'devflow-review-not-git-')))
    roots.push(root)
    const runner = vi.fn(answer(reviewAnswer))
    const openBudgetRelay = vi.fn(async () => relay())
    const reviewProvider = createReadOnlyLocalKnowledgeReviewProvider({
      projectId: 'project-1', projectPath: root, binaryPath: '/not-used/opencode',
      metadata: { id: 'saved-provider', name: 'Saved', model: 'saved-model' },
      processManager: { stopProject: async () => undefined, ensure: async () => { throw new Error('not used') } },
      runtimeEnv: {}, openBudgetRelay, runner,
    })
    const { context, request } = await reviewContext()
    const error = await expectFailure(reviewProvider.reviewKnowledge({ request, context, prompt: 'x' }), 'local_agent_repository_unavailable')
    expect(error).toMatchObject({ deliveryState: 'not_sent', billingState: 'not_incurred' })
    expect(runner).not.toHaveBeenCalled()
    expect(openBudgetRelay).not.toHaveBeenCalled()
  })

  it('maps a stop request and a timeout to the review failure codes', async () => {
    const root = await repository()
    const { context, request } = await reviewContext()
    let sessionSignal: AbortSignal | undefined
    const hanging: ReadOnlyStageAgentRunner = ({ signal }) => new Promise((_, reject) => {
      sessionSignal = signal
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
    // Stop during the session.
    const controller = new AbortController()
    const stopped = provider(root, hanging).provider.reviewKnowledge({ request, context, prompt: 'x', signal: controller.signal })
    await vi.waitFor(() => expect(sessionSignal).toBeDefined())
    controller.abort()
    await expectFailure(stopped, 'cancelled_by_user')

    // Stop before the session starts: no session, nothing billed.
    const early = new AbortController()
    const runner = vi.fn(hanging)
    const unusedRelay = { ...relay(), usageSince: () => undefined, usageAfter: () => undefined }
    const beforeSession = provider(root, runner, unusedRelay).provider.reviewKnowledge({ request, context, prompt: 'x', signal: early.signal })
    early.abort()
    const earlyError = await expectFailure(beforeSession, 'cancelled_by_user')
    expect(earlyError).toMatchObject({ billingState: 'not_incurred' })
    expect(runner).not.toHaveBeenCalled()

    const timedOut = createReadOnlyLocalKnowledgeReviewProvider({
      projectId: 'project-1', projectPath: root, binaryPath: '/not-used/opencode',
      metadata: { id: 'saved-provider', name: 'Saved', model: 'saved-model' },
      processManager: { stopProject: async () => undefined, ensure: async () => { throw new Error('not used') } },
      runtimeEnv: {}, openBudgetRelay: async () => relay(), runner: hanging,
      bounds: { timeoutMs: 20, maxInputBytes: 96 * 1024, maxOutputBytes: 64 * 1024, maxToolCalls: 64, maxCitations: 64 },
    })
    await expectFailure(timedOut.reviewKnowledge({ request, context, prompt: 'x' }), 'provider_timeout')
  })
})
