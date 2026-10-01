import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import {
  AgentProviderRequestError,
  createLocalAgentKnowledgeReviewPrompt,
  LOCAL_AGENT_KNOWLEDGE_REVIEW_BOUNDS,
  readLocalAgentKnowledgeReviewOutput,
  StageAgentExecutionError,
  type AgentProvider,
  type AgentProviderErrorCode,
  type AgentProviderUsage,
  type ClarificationRepositoryFindings,
  type StageAgentExecutionBounds,
} from '@ai-devflow/shared'
import { isGitWorkingTreeRoot } from './git-repository-boundary.js'
import { createIsolatedOpencodeProfile } from './opencode-profile-isolation.js'
import type { OpencodeProviderBinding } from './opencode-provider-binding.js'
import {
  buildReadOnlyStageAgentRuntimeEnv,
  createManagedOpencodeRunner,
  digestRepositoryCitations,
  repositoryWorkingTreeDigest,
  type ManagedOpencodeProcessManager,
  type ReadOnlyStageAgentRunner,
} from './stage-agent-executor.js'

/**
 * Gate Review through a read-only OpenCode session (knowledge-context plan K2, ADR 0025 L2).
 *
 * The session gets the same review prompt as a direct model call plus repository instructions,
 * runs with the read-only permission rules and an isolated OpenCode profile, and every model
 * round goes through the project's budget relay. The repository must be unchanged afterwards.
 * Citations are digested from local bytes; the answer passes the direct-call review schema.
 */

export type LocalAgentReviewBudgetRelay = {
  /** Loopback binding that admits each OpenCode model round against the project budget. */
  binding: OpencodeProviderBinding
  usageSince(since: string): AgentProviderUsage | undefined
  close(): Promise<void>
}

type Metadata = Pick<AgentProvider, 'id' | 'name' | 'model' | 'billingProvider' | 'defaultReviewOutputTokens' | 'effectiveThinking'>

const causeByTerminalReason: Record<string, { code: AgentProviderErrorCode; sanitizedCause: string; retryable: boolean }> = {
  timeout: { code: 'provider_timeout', sanitizedCause: 'provider_timeout', retryable: true },
  cancelled: { code: 'cancelled_by_user', sanitizedCause: 'cancelled_by_user', retryable: false },
  schema_invalid: { code: 'invalid_model_output', sanitizedCause: 'invalid_json', retryable: true },
  evidence_invalid: { code: 'invalid_model_output', sanitizedCause: 'local_agent_invalid_findings', retryable: true },
  output_limit: { code: 'invalid_model_output', sanitizedCause: 'local_agent_tool_limit', retryable: true },
  tool_limit: { code: 'invalid_model_output', sanitizedCause: 'local_agent_tool_limit', retryable: true },
  permission_denied: { code: 'unknown_provider_failure', sanitizedCause: 'local_agent_permission_requested', retryable: false },
  repository_changed: { code: 'unknown_provider_failure', sanitizedCause: 'local_agent_repository_changed', retryable: true },
  repository_unavailable: { code: 'unknown_provider_failure', sanitizedCause: 'local_agent_repository_unavailable', retryable: false },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createReadOnlyLocalKnowledgeReviewProvider(input: {
  projectId: string
  projectPath: string
  binaryPath: string
  metadata: Metadata
  processManager: ManagedOpencodeProcessManager
  runtimeEnv: NodeJS.ProcessEnv
  openBudgetRelay: () => Promise<LocalAgentReviewBudgetRelay>
  knowledgeRoot?: string | null
  bounds?: StageAgentExecutionBounds
  /** Shared cache for the tool binaries OpenCode downloads (#209); see `createIsolatedOpencodeProfile`. */
  toolCacheDirectory?: string
  /** Tests replace the managed OpenCode session; the profile is then not created. */
  runner?: ReadOnlyStageAgentRunner
  now?: () => string
}): AgentProvider {
  const bounds = input.bounds ?? LOCAL_AGENT_KNOWLEDGE_REVIEW_BOUNDS
  const now = input.now ?? (() => new Date().toISOString())
  return {
    ...input.metadata,
    executorKind: 'local-agent',
    async reviewKnowledge({ prompt, signal }) {
      const since = now()
      let relay: LocalAgentReviewBudgetRelay | undefined
      let profile: Awaited<ReturnType<typeof createIsolatedOpencodeProfile>> | undefined
      let reportedUsage: AgentProviderUsage | undefined
      let sessionStarted = false
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), bounds.timeoutMs)
      const abort = () => controller.abort()
      signal?.addEventListener('abort', abort, { once: true })
      // Relayed rounds carry the budget attempt IDs; the session's own report fills the gaps.
      const usage = (): AgentProviderUsage | undefined => {
        const relayed = relay?.usageSince(since)
        return relayed || reportedUsage ? { ...(reportedUsage ?? {}), ...(relayed ?? {}) } : undefined
      }
      const toProviderError = (error: unknown): AgentProviderRequestError => {
        if (error instanceof AgentProviderRequestError) return error
        const known = usage()
        const reason = controller.signal.aborted
          ? signal?.aborted ? 'cancelled' : 'timeout'
          : error instanceof StageAgentExecutionError ? error.terminalReason : 'cli_unavailable'
        const mapped = causeByTerminalReason[reason] ?? { code: 'unknown_provider_failure' as const, sanitizedCause: 'local_agent_unavailable', retryable: true }
        return new AgentProviderRequestError({
          ...mapped,
          deliveryState: known ? 'response_received' : sessionStarted ? 'possibly_delivered' : 'not_sent',
          billingState: known
            ? known.inputTokens !== undefined && known.outputTokens !== undefined ? 'confirmed' : 'unknown'
            : sessionStarted ? 'unknown' : 'not_incurred',
          ...(known ? { usage: known } : {}),
          cause: error,
        })
      }
      try {
        const root = await realpath(input.projectPath).catch(() => {
          throw new StageAgentExecutionError('repository_unavailable', 'Selected project path is unavailable')
        })
        if (!(await isGitWorkingTreeRoot(root))) {
          throw new StageAgentExecutionError('repository_unavailable', 'Select a Git working-tree repository root before repository review')
        }
        const before = await repositoryWorkingTreeDigest(root)
        relay = await input.openBudgetRelay()
        profile = input.runner ? undefined : await createIsolatedOpencodeProfile('devflow-review-opencode-', {
          isolateHome: true,
          ...(input.toolCacheDirectory ? { toolCacheDirectory: input.toolCacheDirectory } : {}),
        })
        const runner = input.runner ?? createManagedOpencodeRunner({
          // A review never replaces a Coding or stage process of the same project.
          projectId: `review:${input.projectId}:${randomUUID()}`,
          binaryPath: input.binaryPath,
          providerId: input.metadata.id,
          modelId: input.metadata.model,
          processManager: input.processManager,
          runtimeEnv: {
            ...buildReadOnlyStageAgentRuntimeEnv(input.runtimeEnv, relay.binding),
            ...(profile?.env ?? {}),
          },
          sessionTitle: 'DevFlow read-only Gate Review',
        })
        // A stop request during the repository checks must not start a session.
        controller.signal.throwIfAborted()
        sessionStarted = true
        const result = await runner({
          prompt: createLocalAgentKnowledgeReviewPrompt(prompt, { knowledgeRoot: input.knowledgeRoot ?? null }),
          directory: root,
          signal: controller.signal,
        })
        reportedUsage = result.value.usage ?? undefined
        if (result.pendingPermissionCount > 0) {
          throw new StageAgentExecutionError('permission_denied', 'Read-only Gate Review requested additional permission')
        }
        if (result.diffCount > 0 || (await repositoryWorkingTreeDigest(root)) !== before) {
          throw new StageAgentExecutionError('repository_changed', 'Repository changed during the read-only Gate Review')
        }
        const value = result.value as unknown as Record<string, unknown>
        const findings = value.repositoryFindings
        const digested = isRecord(findings) && Array.isArray(findings.citations) && findings.citations.length > 0
          ? {
              ...value,
              repositoryFindings: await digestRepositoryCitations(
                findings as unknown as ClarificationRepositoryFindings, root, before,
              ).catch((error: unknown) => {
                throw error instanceof StageAgentExecutionError
                  ? error
                  : new StageAgentExecutionError('evidence_invalid', 'Repository citation could not be read')
              }),
            }
          : value
        const known = usage()
        return readLocalAgentKnowledgeReviewOutput(digested, {
          model: input.metadata.model,
          ...(known ? { usage: known } : {}),
          toolCalls: result.toolCalls,
          bounds,
        })
      } catch (error) {
        throw toProviderError(error)
      } finally {
        clearTimeout(timeout)
        signal?.removeEventListener('abort', abort)
        await profile?.dispose().catch(() => undefined)
        await relay?.close().catch(() => undefined)
      }
    },
  }
}
