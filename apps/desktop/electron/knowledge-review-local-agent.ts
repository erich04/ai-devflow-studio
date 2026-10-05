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
import type { GovernedOpencodeProxy } from './governed-opencode-proxy.js'
import { classifyOpencodeFailure, withOpencodeCleanup } from './opencode-failure.js'
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
} & Pick<GovernedOpencodeProxy, 'checkpoint' | 'usageAfter' | 'failureForRequest'>

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
  return {
    ...input.metadata,
    executorKind: 'local-agent',
    async reviewKnowledge({ prompt, signal }) {
      let checkpoint = 0
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
        const relayed = relay?.usageAfter(checkpoint)
        return relayed || reportedUsage ? { ...(reportedUsage ?? {}), ...(relayed ?? {}) } : undefined
      }
      const toProviderError = (error: unknown): AgentProviderRequestError => {
        const stageError = classifyOpencodeFailure(error, {
          ...(controller.signal.aborted ? { aborted: signal?.aborted ? 'cancelled' : 'timeout' } : {}),
          relayFailure: (requestId) => relay?.failureForRequest(requestId, checkpoint),
        })
        const details = stageError.failureDetails!
        const known = usage() ?? stageError.reportedUsage ?? undefined
        const reason = stageError.terminalReason
        const mapped = causeByTerminalReason[reason] ?? {
          code: details.code === 'provider_auth' ? 'http_4xx' as const
            : details.code === 'provider_rate_limit' ? 'http_429' as const
              : details.code === 'provider_unavailable' ? 'http_5xx' as const
                : details.code === 'output_format' ? 'invalid_model_output' as const : 'unknown_provider_failure' as const,
          sanitizedCause: details.code === 'runtime_unavailable' ? 'local_agent_unavailable' : `local_agent_${details.code}`,
          retryable: false,
        }
        const notSent = !sessionStarted || ['budget_denied', 'accounting_unavailable', 'runtime_unavailable'].includes(details.code)
        return new AgentProviderRequestError({
          ...mapped,
          ...(error instanceof AgentProviderRequestError && !controller.signal.aborted ? { code: error.code, sanitizedCause: error.sanitizedCause, retryable: error.retryable } : {}),
          deliveryState: known ? 'response_received' : notSent ? 'not_sent' : 'possibly_delivered',
          billingState: known
            ? known.inputTokens !== undefined && known.outputTokens !== undefined && !known.missingUsageCount ? 'confirmed' : 'unknown'
            : notSent ? 'not_incurred' : 'unknown',
          ...(known ? { usage: known } : {}),
          failureDetails: details,
          ...(details.httpStatus ? { httpStatus: details.httpStatus } : {}),
        })
      }
      try {
        return await withOpencodeCleanup(() => withOpencodeCleanup(async () => {
          const root = await realpath(input.projectPath).catch(() => {
            throw new StageAgentExecutionError('repository_unavailable', 'Selected project path is unavailable')
          })
          if (!(await isGitWorkingTreeRoot(root))) {
            throw new StageAgentExecutionError('repository_unavailable', 'Select a Git working-tree repository root before repository review')
          }
          const before = await repositoryWorkingTreeDigest(root)
          relay = await input.openBudgetRelay()
          checkpoint = relay.checkpoint()
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
          controller.signal.throwIfAborted()
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
        }, async () => { await profile?.dispose() }, 'profile_dispose', (result) => result.usage),
        async () => { await relay?.close() }, 'relay_close', (result) => result.usage)
      } catch (error) {
        throw toProviderError(error)
      } finally {
        clearTimeout(timeout)
        signal?.removeEventListener('abort', abort)
      }
    },
  }
}
