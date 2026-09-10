import { StageAgentExecutionError, type AgentProviderUsage, type WorkflowArtifactProviderOutput } from '@ai-devflow/shared'
import type { OpencodeMessage } from './opencode-http-adapter.js'

export function readStageAgentOpencodeOutput(input: {
  response: unknown
  messages: OpencodeMessage[]
  providerId: string
  modelId: string
}): { value: WorkflowArtifactProviderOutput; toolCalls: number } {
  if (!isRecord(input.response) || !Array.isArray(input.response.parts)) {
    throw new StageAgentExecutionError('schema_invalid', 'Managed stage Agent returned no structured response')
  }
  const candidates = input.messages.filter((message) => message.info.role === 'assistant')
  const responseInfo = input.response.info
  if (isRecord(responseInfo) && responseInfo.role === 'assistant' &&
    !candidates.some((message) => message.info.id === responseInfo.id)) {
    candidates.push(input.response as OpencodeMessage)
  }
  const assistantMessages = [...new Map(candidates.map((message) => [message.info.id, message])).values()]
  for (const info of [input.response.info, ...assistantMessages.map((message) => message.info)]) {
    if (!isRecord(info) || info.providerID !== input.providerId || info.modelID !== input.modelId) {
      throw new StageAgentExecutionError('schema_invalid', 'OpenCode response does not match the selected Provider and Model')
    }
  }
  const usage = reportedUsage(assistantMessages)
  const invalid = (reason: 'schema_invalid' | 'evidence_invalid', message: string) =>
    new StageAgentExecutionError(reason, message, undefined, usage ?? null)
  const text = input.response.parts
    .filter((part): part is { type: string; text: string } =>
      isRecord(part) && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text).join('\n').trim()
  let parsed: Record<string, unknown>
  try {
    const value: unknown = JSON.parse(text)
    if (!isRecord(value)) throw new Error('not an object')
    parsed = value
  } catch {
    throw invalid('schema_invalid', 'Managed stage Agent returned invalid JSON')
  }
  if (isRecord(parsed.repositoryFindings) && Array.isArray(parsed.repositoryFindings.citations) &&
    parsed.repositoryFindings.citations.some((citation) => !isRecord(citation))) {
    throw invalid('evidence_invalid', 'Repository citations must be objects with id and repo-relative path')
  }
  // Model identity and usage come from the executor, never model-authored JSON.
  delete parsed.usage
  return {
    value: { ...parsed, model: input.modelId, ...(usage ? { usage } : {}) } as WorkflowArtifactProviderOutput,
    toolCalls: assistantMessages.reduce((count, message) => count +
      message.parts.filter((part) => isRecord(part) && part.type === 'tool').length, 0),
  }
}

function reportedUsage(messages: OpencodeMessage[]): AgentProviderUsage | undefined {
  if (!messages.length) return undefined
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let missingUsageCount = 0
  let reportedCount = 0
  for (const message of messages) {
    const tokens = message.info.tokens
    if (!isRecord(tokens) || !isRecord(tokens.cache)) { missingUsageCount += 1; continue }
    const counts = [tokens.input, tokens.output, tokens.reasoning, tokens.cache.read, tokens.cache.write]
    if (counts.some((value) => typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)) { missingUsageCount += 1; continue }
    reportedCount += 1
    // OpenCode reports cache and reasoning separately from input/output.
    inputTokens += Number(tokens.input) + Number(tokens.cache.read) + Number(tokens.cache.write)
    outputTokens += Number(tokens.output) + Number(tokens.reasoning)
    cacheReadTokens += Number(tokens.cache.read)
  }
  if (!reportedCount || ![inputTokens, outputTokens, cacheReadTokens, inputTokens + outputTokens].every(Number.isSafeInteger)) return undefined
  return { inputTokens, outputTokens, cacheReadTokens, cacheMissTokens: inputTokens - cacheReadTokens,
    totalTokens: inputTokens + outputTokens, cacheStatus: 'complete',
    ...(missingUsageCount ? { missingUsageCount } : {}) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
