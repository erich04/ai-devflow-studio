import { randomUUID } from 'node:crypto'
import {
  buildAgentReviewContext,
  canRunKnowledgeReviewOnNode,
  assessAgentReviewFreshness,
  AgentProviderRequestError,
  describeAgentProviderFailure,
  createAgentReviewArtifacts,
  deriveWorkflowContextPolicyRequirements,
  redactSensitiveText,
  runBudgetedKnowledgeReviewAgent,
  AGENT_MEMORY_RETRIEVAL_LIMIT_MAX,
  STAGE_AGENT_MEMORY_RECALL_BUDGET,
  type AgentEvent,
  type AgentProvider,
  type AgentReviewResult,
  type AgentReviewContext,
  type AgentTokenUsage,
  type AgentTrace,
  type Artifact,
  type KnowledgeChunk,
  type ProjectInstructionsSnapshot,
  type RetrievedKnowledgeContext,
  type RetrievedKnowledgeManifest,
  type KnowledgeDocument,
  type KnowledgeReviewBudgetGuard,
  type LocalExecutionState,
  type PolicySnapshot,
  type TestEvidence,
  type WorkflowRun,
} from '@ai-devflow/shared'
import type { RunKnowledgeReviewInput, RunKnowledgeReviewResult } from './ipc-contract.js'
import { assertProjectMemoryCurrent, executionScope, recallScopedMemory, type CodingMemoryStore, type RecalledMemory } from './coding-context.js'

export type KnowledgeReviewProviderMetadata = Pick<AgentProvider, 'id' | 'name' | 'model' | 'billingProvider' | 'defaultReviewOutputTokens' | 'effectiveThinking' | 'executorKind'>

export type KnowledgeReviewRuntimeStore = CodingMemoryStore & {
  listRuns(): Promise<WorkflowRun[]>
  listArtifacts(runId?: string): Promise<Artifact[]>
  listTestEvidence(runId?: string): Promise<TestEvidence[]>
  listEvents(runId?: string): Promise<AgentEvent[]>
  listAgentReviews(runId?: string): Promise<AgentReviewResult[]>
  getPolicySnapshot?(projectId: string): Promise<PolicySnapshot | null>
  saveArtifact(artifact: Artifact): Promise<void>
  saveEvent(event: AgentEvent): Promise<void>
  saveAgentReview(review: AgentReviewResult): Promise<void>
  saveAgentTrace(trace: AgentTrace): Promise<void>
  saveAgentTokenUsage(usage: AgentTokenUsage): Promise<void>
  loadState(): Promise<LocalExecutionState>
}

export type KnowledgeReviewRuntimeDependencies = {
  store: KnowledgeReviewRuntimeStore
  knowledgeDocuments: KnowledgeDocument[]
  knowledgeChunks: KnowledgeChunk[]
  knowledgeRoot?: string | null
  /** Repository instruction file (ADR 0025 L0). */
  projectInstructions?: ProjectInstructionsSnapshot | null
  prepareRetrievedKnowledge?: (input: {
    projectId: string; userId: string; stage: WorkflowRun['nodes'][number]['stage']; query: string; signal?: AbortSignal
  }) => Promise<RetrievedKnowledgeContext | undefined>
  assertRetrievedKnowledgeCurrent?: (manifest: RetrievedKnowledgeManifest) => Promise<void>
  resolveProviderMetadata(providerId: string): Promise<KnowledgeReviewProviderMetadata>
  resolveProvider(providerId: string): Promise<AgentProvider>
  budgetGuard?: KnowledgeReviewBudgetGuard
  now?: () => string
  createRequestId?: () => string
  signal?: AbortSignal
  beforeCommit?: () => void
  loadPolicySnapshot?: (localProjectId: string) => Promise<PolicySnapshot | null>
}

export type KnowledgeReviewRuntime = {
  run(input: RunKnowledgeReviewInput): Promise<RunKnowledgeReviewResult>
}

// IPC builds a Runtime per request; the execution lease belongs to the shared store.
const pendingReviewsByStore = new WeakMap<KnowledgeReviewRuntimeStore, Set<string>>()

function blockedMessage(status: string): string {
  if (status === 'requires_lead_approval') {
    return '基于知识的门禁审查在调用 Provider 前被阻断。重试前需要有效的 Lead runtime budget approval。'
  }
  if (status === 'unavailable') {
    return '基于知识的门禁审查尚未调用模型：预算检查未就绪。'
  }
  return '基于知识的门禁审查被权威 Team budget policy 阻断，尚未调用 Provider。'
}

function failureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return redactSensitiveText(detail).value
}

export function createKnowledgeReviewRuntime(
  deps: KnowledgeReviewRuntimeDependencies,
): KnowledgeReviewRuntime {
  const now = deps.now ?? (() => new Date().toISOString())
  const createRequestId = deps.createRequestId ?? (() => `review-request-${randomUUID()}`)
  const pendingReviews = pendingReviewsByStore.get(deps.store) ?? new Set<string>()
  pendingReviewsByStore.set(deps.store, pendingReviews)

  async function persistError(input: RunKnowledgeReviewInput, requestId: string, message: string) {
    const redactedMessage = redactSensitiveText(message).value
    const event: AgentEvent = {
      id: `event-${requestId}-error`,
      runId: input.runId,
      nodeId: input.nodeId,
      sequence: (await deps.store.listEvents(input.runId)).length + 1,
      kind: 'error',
      message: redactedMessage,
      timestamp: now(),
    }
    await deps.store.saveEvent(event)
  }

  async function executeReview(input: RunKnowledgeReviewInput): Promise<RunKnowledgeReviewResult> {
    const requestId = createRequestId()
    const runs = await deps.store.listRuns()
    const run = runs.find((candidate) => candidate.id === input.runId)
    if (!run) {
      throw new Error(`Run not found: ${input.runId}`)
    }
    const node = run.nodes.find((candidate) => candidate.id === input.nodeId)
    if (!node) {
      throw new Error(`Run node not found: ${input.nodeId}`)
    }
    if (
      run.projectId !== input.projectId ||
      run.currentNodeId !== node.id ||
      !canRunKnowledgeReviewOnNode(node) ||
      (node.status !== 'running' && node.status !== 'blocked')
    ) {
      throw new Error('基于知识的门禁审查只能针对当前 Gate、PR 交付或 Acceptance 节点运行')
    }
    if (!input.providerId) {
      throw new Error(
        '门禁审查 Provider 尚未配置。运行门禁审查前请保存 Provider Name、Base URL、Model 和 API Key。',
      )
    }

    const latestReview = (await deps.store.listAgentReviews(input.runId))
      .filter((review) => review.projectId === input.projectId && review.nodeId === input.nodeId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
    if (latestReview && !input.previousReviewId) {
      throw new Error('该 Gate 已有审查结果；重新审查需要确认会新增记录并可能产生 Provider 费用。')
    }
    if (input.previousReviewId && input.previousReviewId !== latestReview?.id) {
      throw new Error('审查记录已更新，请查看最新结果并重新确认。')
    }

    const providerId = input.providerId
    let providerMetadata: KnowledgeReviewProviderMetadata
    try {
      providerMetadata = await deps.resolveProviderMetadata(providerId)
    } catch (error) {
      const detail = failureMessage(error)
      await persistError(input, requestId, `门禁审查 Provider metadata 不可用：${detail}`)
      throw new Error(`基于知识的门禁审查在调用 Provider 前被阻断：${detail}`)
    }

    const [artifacts, testEvidence, policySnapshot] = await Promise.all([
      deps.store.listArtifacts(input.runId),
      deps.store.listTestEvidence(input.runId),
      deps.loadPolicySnapshot
        ? deps.loadPolicySnapshot(input.projectId)
        : deps.store.getPolicySnapshot?.(input.projectId) ?? Promise.resolve(null),
    ])
    let context: AgentReviewContext
    let recalledMemory: RecalledMemory | undefined
    try {
      deps.signal?.throwIfAborted()
      const query = [run.request, node.title, node.subtitle,
        ...artifacts.filter((artifact) => node.artifactIds.includes(artifact.id))
          .map((artifact) => `${artifact.title}\n${artifact.summary}`),
      ].join('\n')
      const retrievedKnowledge = await deps.prepareRetrievedKnowledge?.({
        projectId: input.projectId, userId: input.requestedBy, stage: node.stage,
        query,
        ...(deps.signal ? { signal: deps.signal } : {}),
      })
      if (deps.store.retrieveAgentMemoryRevisions || deps.store.getAgentMemoryHead) {
        recalledMemory = await recallScopedMemory({
          store: deps.store, projectId: input.projectId, userId: input.requestedBy,
          runtimeId: `agent-runtime-review-${requestId}`, requestId: `review-memory-${requestId}`,
          query, now: now(), budget: STAGE_AGENT_MEMORY_RECALL_BUDGET,
        })
      }
      context = await buildAgentReviewContext({
        run,
        node,
        artifacts,
        testEvidence,
        knowledgeDocuments: deps.knowledgeDocuments,
        knowledgeChunks: deps.knowledgeChunks,
        ...(deps.knowledgeRoot !== undefined ? { knowledgeRoot: deps.knowledgeRoot } : {}),
        knowledgeExecutor: providerMetadata.executorKind ?? 'direct-provider',
        ...(deps.projectInstructions ? { projectInstructions: deps.projectInstructions } : {}),
        ...(retrievedKnowledge ? { retrievedKnowledge } : {}),
        ...(recalledMemory ? {
          backgroundMemory: recalledMemory.memories.map((identity) => ({
            ...identity, statement: recalledMemory!.context.find((item) => item.id === identity.id)!.statement,
          })),
          omittedMemoryCount: recalledMemory.omittedMemoryCount,
        } : {}),
        policySnapshot,
        requiredContextFields: deriveWorkflowContextPolicyRequirements(
          policySnapshot?.effectivePolicy,
          node,
        ),
      })
    } catch (error) {
      const detail = failureMessage(error)
      await persistError(input, requestId, `门禁审查对象不完整：${detail}`)
      throw new Error(`基于知识的门禁审查在调用 Provider 前被阻断：${detail}`)
    }
    const assertRetrievedKnowledge = async () => {
      const manifest = context.manifest.knowledgeContext?.retrievedKnowledge
      if (!manifest?.references.length) return
      if (manifest.scope.projectId !== input.projectId || manifest.scope.userId !== input.requestedBy) {
        throw new Error('Review retrieved knowledge scope does not match the current actor')
      }
      if (!deps.assertRetrievedKnowledgeCurrent) throw new Error('Review retrieved knowledge verification is unavailable')
      await deps.assertRetrievedKnowledgeCurrent(manifest)
    }
    const assertMemoryCurrent = async () => {
      if (!recalledMemory) return
      const scope = await executionScope({ store: deps.store, projectId: input.projectId,
        userId: input.requestedBy, runtimeId: recalledMemory.runtimeId })
      if (JSON.stringify(scope) !== JSON.stringify(recalledMemory.scope)) throw new Error('Review Memory scope changed')
      let identities = context.manifest.backgroundMemory?.memories ?? []
      try {
        identities = await assertProjectMemoryCurrent(deps.store, { projectId: input.projectId, userId: input.requestedBy, identities,
          recalledAt: recalledMemory.recalledAt })
      } catch { throw new Error('Review Memory changed, expired or was deleted') }
      if (!identities.length) return
      if (!deps.store.retrieveAgentMemoryRevisions || !deps.store.getAgentMemoryHead) throw new Error('Review Memory store is unavailable')
      const observedAt = now()
      const retrieval = { stateVersion: 1, id: `review-memory-check-${requestId}`, scope,
        runtimeId: recalledMemory.runtimeId, limit: AGENT_MEMORY_RETRIEVAL_LIMIT_MAX, requestedAt: observedAt } as const
      const current = deps.store.hydrateAgentMemoryRevisions
        ? await deps.store.hydrateAgentMemoryRevisions(retrieval, identities.map((entry) => entry.id))
        : await deps.store.retrieveAgentMemoryRevisions(retrieval)
      for (const identity of identities) {
        const revision = current.find((entry) => entry.id === identity.id)
        const head = await deps.store.getAgentMemoryHead(identity.id)
        if (!revision || !head || head.status !== 'active' || head.version !== identity.headVersion ||
          head.currentRevision !== identity.revision || revision.status !== 'active' || revision.revision !== identity.revision ||
          revision.contentDigest !== identity.contentDigest || (revision.expiresAt && Date.parse(revision.expiresAt) <= Date.parse(observedAt))) {
          throw new Error('Review Memory changed, expired or was deleted')
        }
      }
    }

    // Resolve once per review operation so repair attempts share one budget consent.
    // The provider guard still checks credentials and cancellation on every actual call.
    let resolvedProvider: AgentProvider | undefined
    const lazyProvider: AgentProvider = {
      ...providerMetadata,
      reviewKnowledge: async (providerInput) => {
        let provider: AgentProvider
        try { provider = resolvedProvider ??= await deps.resolveProvider(providerId) } catch (error) {
          throw new AgentProviderRequestError({ code: 'unknown_provider_failure', sanitizedCause: 'credential_unavailable', deliveryState: 'not_sent', billingState: 'not_incurred', retryable: false, cause: error })
        }
        if (provider.id !== providerMetadata.id || provider.model !== providerMetadata.model ||
          (provider.executorKind ?? 'direct-provider') !== (providerMetadata.executorKind ?? 'direct-provider')) {
          throw new AgentProviderRequestError({ code: 'unknown_provider_failure', sanitizedCause: 'provider_configuration_changed', deliveryState: 'not_sent', billingState: 'not_incurred', retryable: false })
        }
        try { await assertRetrievedKnowledge(); await assertMemoryCurrent() } catch (error) {
          throw new AgentProviderRequestError({ code: 'unknown_provider_failure', sanitizedCause: 'retrieved_knowledge_stale',
            deliveryState: 'not_sent', billingState: 'not_incurred', retryable: false, cause: error })
        }
        return provider.reviewKnowledge(providerInput)
      },
    }

    let budgetedResult
    try {
      await assertRetrievedKnowledge()
      await assertMemoryCurrent()
      budgetedResult = await runBudgetedKnowledgeReviewAgent({
        request: {
          id: requestId,
          runId: input.runId,
          nodeId: input.nodeId,
          projectId: input.projectId,
          requestedBy: input.requestedBy,
          runtime: 'electron',
          providerId,
        },
        context,
        provider: lazyProvider,
        ...(deps.budgetGuard ? { budgetGuard: deps.budgetGuard } : {}),
        ...(input.runtimeBudgetApprovalId
          ? { approvalId: input.runtimeBudgetApprovalId }
          : {}),
        now,
        ...(deps.signal ? { signal: deps.signal } : {}),
        onAttemptUsage: (usage) => deps.store.saveAgentTokenUsage(usage),
        onAttemptFailure: async failure => persistError(input, `${requestId}-attempt-${failure.attempt}`, `门禁审查调用未完成：${JSON.stringify({ ...failure, cause: failure.reason })}`),
      })
    } catch (error) {
      const detail = error instanceof AgentProviderRequestError ? describeAgentProviderFailure(error) : failureMessage(error)
      const diagnostic = error instanceof AgentProviderRequestError ? JSON.stringify({ requestId, model: providerMetadata.model, code: error.code, cause: error.sanitizedCause, billingState: error.billingState, ...error.responseMetadata }) : ''
      await persistError(input, requestId, `门禁审查在产物保存前失败：${detail} ${diagnostic}`)
      if (error instanceof AgentProviderRequestError && error.failureDetails) {
        const createdAt = now()
        await deps.store.saveAgentTrace({
          id: `agent-trace-${requestId}-error`, runId: input.runId, nodeId: input.nodeId,
          reviewId: requestId, runtime: 'electron', createdAt, failureDetails: error.failureDetails,
          terminalReason: error.code === 'cancelled_by_user' ? 'cancelled' : error.code === 'provider_timeout' ? 'timeout' : 'failed',
          steps: [{ id: `agent-trace-${requestId}-error-terminal`, kind: 'provider_call', label: 'Gate Review', summary: detail, timestamp: createdAt }],
        })
      }
      throw new Error(`基于知识的门禁审查在产物保存前失败：${detail}`)
    }

    if (budgetedResult.status === 'blocked') {
      const message = `${blockedMessage(budgetedResult.budgetDecision.status)} ${budgetedResult.budgetDecision.reason}`
      await persistError(
        input,
        requestId,
        `${message} ${budgetedResult.evidence.reason}`,
      )
      throw new Error(message)
    }

    const result = budgetedResult.execution
    await assertRetrievedKnowledge()
    await assertMemoryCurrent()
    const latestRun = (await deps.store.listRuns()).find((candidate) => candidate.id === run.id)
    if (!latestRun || latestRun.version !== run.version || latestRun.currentNodeId !== node.id ||
      (await assessAgentReviewFreshness({ review: result.review, run: latestRun, node, artifacts: await deps.store.listArtifacts(run.id) })).status !== 'current') {
      throw new Error('审查期间流程或正文已更新，未保存过期报告；请重新审查。')
    }
    deps.signal?.throwIfAborted()
    deps.beforeCommit?.()
    const output = createAgentReviewArtifacts(result)
    const event: AgentEvent = {
      ...output.event,
      sequence: (await deps.store.listEvents(input.runId)).length + 1,
    }

    await deps.store.saveArtifact(output.artifact)
    await deps.store.saveEvent(event)
    await deps.store.saveAgentReview(result.review)
    await deps.store.saveAgentTrace(result.trace)
    return {
      ...result,
      state: await deps.store.loadState(),
    }
  }

  return {
    async run(input) {
      const key = JSON.stringify([input.projectId, input.runId, input.nodeId])
      if (pendingReviews.has(key)) {
        throw new Error('当前 Gate 的门禁审查正在运行，请等待完成后再操作。')
      }
      pendingReviews.add(key)
      try {
        return await executeReview(input)
      } finally {
        pendingReviews.delete(key)
      }
    },
  }
}
