import path from 'node:path'
import { realpath } from 'node:fs/promises'
import {
  AgentProviderRequestError, expandedOutputAllowance, waitForProviderRetry, modelExecutionRollout, createLocalAgentKnowledgeReviewPrompt, readLocalAgentKnowledgeReviewOutput,
  validateNativeToolBatch, MODEL_CONTENT_BYTES, LOCAL_AGENT_KNOWLEDGE_REVIEW_BOUNDS,
  type AgentProvider, type AgentProviderUsage, type ClarificationRepositoryFindings,
} from '@ai-devflow/shared'
import { readWorkbenchRepository } from './workbench-repository.js'
import { digestRepositoryCitations, repositoryWorkingTreeDigest } from './stage-agent-executor.js'
import { isGitWorkingTreeRoot } from './git-repository-boundary.js'

const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
function usageSummary(rows: Array<AgentProviderUsage | undefined>): AgentProviderUsage | undefined {
  if (!rows.length) return undefined
  const missing = rows.reduce((sum, row) => sum + (row?.missingUsageCount ?? (!row || row.inputTokens === undefined || row.outputTokens === undefined || row.usageCompleteness === 'partial' ? 1 : 0)), 0)
  return {
    inputTokens: rows.reduce((sum, row) => sum + (row?.inputTokens ?? 0), 0),
    outputTokens: rows.reduce((sum, row) => sum + (row?.outputTokens ?? 0), 0),
    cacheReadTokens: rows.reduce((sum, row) => sum + (row?.cacheReadTokens ?? 0), 0),
    ...(rows.every(row => row?.cacheStatus === 'complete') ? { cacheStatus: 'complete' as const } : { cacheStatus: 'unknown' as const }),
    ...(rows[0]?.billingProvider ? { billingProvider: rows[0].billingProvider } : {}),
    budgetAttemptIds: [...new Set(rows.flatMap(row => row?.budgetAttemptIds ?? []))],
    ...(missing ? { missingUsageCount: missing, usageCompleteness: 'partial' as const } : { usageCompleteness: 'final' as const }),
  }
}

/** A host-owned read-only review loop. It never creates a coding executor or invokes a shell tool. */
export function createNativeRepositoryReviewProvider(input: { projectPath: string; provider: AgentProvider; knowledgeRoot?: string | null }): AgentProvider {
  const base = input.provider
  return { ...base, name: `内置仓库审查 · ${base.name}`, executorKind: 'native-agent',
    async reviewKnowledge({ prompt, signal }) {
      if (!base.completeStructuredJson) throw new Error('所选 Provider 不支持内置仓库审查。')
      const controller = new AbortController()
      const cancel = () => controller.abort()
      signal?.addEventListener('abort', cancel, { once: true })
      if (signal?.aborted) controller.abort()
      const timer = setTimeout(cancel, 240_000)
      const usageRows: Array<AgentProviderUsage | undefined> = []
      const observations: unknown[] = []
      const readFiles = new Map<string, { hash: string; lines: number; truncated: boolean }>()
      let toolCount = 0
      let requestStarted = false
      const failure = (cause: string, code: 'invalid_model_output' | 'unknown_provider_failure' = 'invalid_model_output') => new AgentProviderRequestError({
        code, sanitizedCause: cause, retryable: false, deliveryState: usageRows.length ? 'response_received' : 'not_sent',
        billingState: !usageRows.length ? 'not_incurred' : usageSummary(usageRows)?.missingUsageCount ? 'unknown' : 'confirmed',
        ...(usageSummary(usageRows) ? { usage: usageSummary(usageRows)! } : {}),
      })
      try {
        controller.signal.throwIfAborted()
        const root = await realpath(input.projectPath)
        if (!(await isGitWorkingTreeRoot(root))) throw failure('native_review_repository_unavailable', 'unknown_provider_failure')
        const before = await repositoryWorkingTreeDigest(root)
        const instructions = createLocalAgentKnowledgeReviewPrompt(prompt, { knowledgeRoot: input.knowledgeRoot ?? null })
        let retries = 0
        let maxOutputTokens: number | undefined
        for (let step = 0; step < 12; step++) {
          controller.signal.throwIfAborted()
          let received = false
          try {
            requestStarted = true
            const result = await base.completeStructuredJson({
              purpose: 'review', signal: controller.signal, ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
              systemPrompt: 'Return one JSON object. To inspect the repository return {"tool":{"name":"repo_list|repo_read|repo_search","args":{...}}}. Only repo-relative paths and read-only operations are available. Final review must follow the supplied schema and cite files actually read. Never edit, execute commands or approve a Gate.',
              userPrompt: JSON.stringify({ instructions, observations, ...(retries ? { correction: 'Previous output was invalid. Return a complete valid tool request or review with verified file citations.' } : {}) }),
            })
            received = true
            usageRows.push(result.usage)
            const tool = object(result.value.tool)
            if (result.value.tool !== undefined) {
              const [entry] = validateNativeToolBatch([{ id: `review-${step}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args ?? {}) } }], ['repo_list', 'repo_read', 'repo_search'])
              if (++toolCount > 12) throw failure('native_review_tool_limit')
              const output = await readWorkbenchRepository(root, {
                operation: entry!.name === 'repo_read' ? 'read' : entry!.name === 'repo_list' ? 'list' : 'search',
                ...(typeof entry!.args.path === 'string' ? { path: entry!.args.path } : {}),
                ...(typeof entry!.args.query === 'string' ? { query: entry!.args.query } : {}),
              }, controller.signal)
              const file = object(output)
              if (entry!.name === 'repo_read' && typeof file.path === 'string' && typeof file.content === 'string' && typeof file.contentHash === 'string') {
                readFiles.set(path.posix.normalize(file.path), { hash: file.contentHash, lines: file.content.split('\n').length, truncated: file.truncated === true })
              }
              observations.push({ tool: entry!.name, args: entry!.args, result: output })
              retries = 0
              continue
            }
            const findings = object(result.value.repositoryFindings)
            const citations = findings.citations
            if (!Array.isArray(citations) || !citations.length || citations.some(raw => {
              const citation = object(raw)
              const read = typeof citation.path === 'string' ? readFiles.get(path.posix.normalize(citation.path)) : undefined
              return !read || !Number.isSafeInteger(citation.lineStart) || !Number.isSafeInteger(citation.lineEnd) ||
                Number(citation.lineStart) < 1 || Number(citation.lineEnd) < Number(citation.lineStart) || Number(citation.lineEnd) > read.lines
            })) throw failure('native_review_invalid_findings')
            if (await repositoryWorkingTreeDigest(root) !== before) throw failure('native_review_repository_changed')
            const verified = await digestRepositoryCitations(findings as unknown as ClarificationRepositoryFindings, root, before)
            // A complete file read must still match the exact bytes observed, not merely the final snapshot.
            if (verified.citations.some(citation => { const read = readFiles.get(citation.path)!; return !read.truncated && read.hash !== citation.contentDigest })) throw failure('native_review_repository_changed')
            controller.signal.throwIfAborted()
            return { ...readLocalAgentKnowledgeReviewOutput({ ...result.value, repositoryFindings: verified }, {
              model: base.model, toolCalls: toolCount, usage: usageSummary(usageRows)!,
              bounds: { ...LOCAL_AGENT_KNOWLEDGE_REVIEW_BOUNDS, maxOutputBytes: MODEL_CONTENT_BYTES },
            }), ...(base.effectiveThinking ? { effectiveThinking: base.effectiveThinking } : {}), ...(result.reasoningContent ? { reasoningContent: result.reasoningContent } : {}) }
          } catch (error) {
            if (!received && error instanceof AgentProviderRequestError && error.billingState !== 'not_incurred') usageRows.push(error.usage)
            if (error instanceof AgentProviderRequestError && error.sanitizedCause === 'output_length') {
              const policy = base.resolveRequestPolicy?.({ ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }) })
              const expanded = policy && expandedOutputAllowance(policy)
              if (!expanded) throw error
              maxOutputTokens = expanded
            }
            if (!modelExecutionRollout().stepRecovery || controller.signal.aborted || (error instanceof AgentProviderRequestError && !error.retryable) || retries >= 2) throw error
            retries++; step--; await waitForProviderRetry(error, retries, controller.signal)
          }
        }
        throw failure('native_review_tool_limit')
      } catch (error) {
        if (controller.signal.aborted) throw new AgentProviderRequestError({ code: signal?.aborted ? 'cancelled_by_user' : 'provider_timeout', deliveryState: requestStarted ? 'possibly_delivered' : 'not_sent', billingState: requestStarted ? 'unknown' : 'not_incurred', retryable: false, sanitizedCause: signal?.aborted ? 'cancelled_by_user' : 'native_review_timeout', ...(usageSummary(usageRows) ? { usage: usageSummary(usageRows)! } : {}) })
        if (error instanceof AgentProviderRequestError) throw new AgentProviderRequestError({ ...error, ...(usageSummary(usageRows) ? { usage: usageSummary(usageRows)! } : {}), cause: error })
        throw failure('native_review_failed', 'unknown_provider_failure')
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
    },
  }
}
