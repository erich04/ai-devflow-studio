import {
  buildAgentReviewContext,
  createAgentReviewArtifacts,
  redactSensitiveText,
  runBudgetedKnowledgeReviewAgent,
  type AgentEvent,
  type AgentProvider,
  type AgentReviewResult,
  type AgentTokenUsage,
  type AgentTrace,
  type Artifact,
  type KnowledgeChunk,
  type KnowledgeDocument,
  type KnowledgeReviewBudgetGuard,
  type LocalExecutionState,
  type TestEvidence,
  type WorkflowRun,
} from '@ai-devflow/shared'
import type { RunKnowledgeReviewInput, RunKnowledgeReviewResult } from './ipc-contract.js'

export type KnowledgeReviewProviderMetadata = Pick<AgentProvider, 'id' | 'name' | 'model'>

export type KnowledgeReviewRuntimeStore = {
  listRuns(): Promise<WorkflowRun[]>
  listArtifacts(runId?: string): Promise<Artifact[]>
  listTestEvidence(runId?: string): Promise<TestEvidence[]>
  listEvents(runId?: string): Promise<AgentEvent[]>
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
  resolveProviderMetadata(providerId: string): Promise<KnowledgeReviewProviderMetadata>
  resolveProvider(providerId: string): Promise<AgentProvider>
  budgetGuard?: KnowledgeReviewBudgetGuard
  now?: () => string
  createRequestId?: () => string
}

export type KnowledgeReviewRuntime = {
  run(input: RunKnowledgeReviewInput): Promise<RunKnowledgeReviewResult>
}

function blockedMessage(status: string): string {
  if (status === 'requires_lead_approval') {
    return '基于知识的门禁审查在调用 Provider 前被阻断。重试前需要有效的 Lead runtime budget approval。'
  }
  if (status === 'unavailable') {
    return '基于知识的门禁审查在调用 Provider 前被阻断。请先配对项目并恢复已认证的 Team 连接。'
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
  const createRequestId = deps.createRequestId ?? (() => `review-request-${Date.now()}`)

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

  return {
    async run(input) {
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
        (node.kind !== 'gate' && node.kind !== 'acceptance') ||
        (node.status !== 'running' && node.status !== 'blocked')
      ) {
        throw new Error('基于知识的门禁审查只能针对当前 Gate 或 Acceptance 节点运行')
      }
      if (!input.providerId) {
        throw new Error(
          '门禁审查 Provider 尚未配置。运行门禁审查前请保存 Provider Name、Base URL、Model 和 API Key。',
        )
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

      const [artifacts, testEvidence] = await Promise.all([
        deps.store.listArtifacts(input.runId),
        deps.store.listTestEvidence(input.runId),
      ])
      const context = buildAgentReviewContext({
        run,
        node,
        artifacts,
        testEvidence,
        knowledgeDocuments: deps.knowledgeDocuments,
        knowledgeChunks: deps.knowledgeChunks,
      })

      const lazyProvider: AgentProvider = {
        ...providerMetadata,
        reviewKnowledge: async (providerInput) => {
          const provider = await deps.resolveProvider(providerId)
          if (provider.id !== providerMetadata.id || provider.model !== providerMetadata.model) {
            throw new Error('Agent provider configuration changed after budget authorization. Retry the review.')
          }
          return provider.reviewKnowledge(providerInput)
        },
      }

      let budgetedResult
      try {
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
        })
      } catch (error) {
        const detail = failureMessage(error)
        await persistError(input, requestId, `门禁审查在产物保存前失败：${detail}`)
        throw new Error(`基于知识的门禁审查在产物保存前失败：${detail}`)
      }

      if (budgetedResult.status === 'blocked') {
        const message = blockedMessage(budgetedResult.budgetDecision.status)
        await persistError(
          input,
          requestId,
          `${message} ${budgetedResult.evidence.reason}`,
        )
        throw new Error(message)
      }

      const result = budgetedResult.execution
      const output = createAgentReviewArtifacts(result)
      const event: AgentEvent = {
        ...output.event,
        sequence: (await deps.store.listEvents(input.runId)).length + 1,
      }

      await deps.store.saveArtifact(output.artifact)
      await deps.store.saveEvent(event)
      await deps.store.saveAgentReview(result.review)
      await deps.store.saveAgentTrace(result.trace)
      await deps.store.saveAgentTokenUsage(result.tokenUsage)
      return {
        ...result,
        state: await deps.store.loadState(),
      }
    },
  }
}
