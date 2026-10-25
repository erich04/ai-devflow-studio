import type { AgentProviderResponseMetadata } from './agent-review'
import type { ResponseReadDiagnostics } from './provider-response'
import type { EffectiveProviderThinking } from './provider-thinking'
import type { ModelRequestPurpose } from './provider-request-policy'
import { redactSensitiveText } from './redaction'

/** Actual sent configuration only. Never contains prompts, headers, tool definitions or model output. */
export type AgentProviderRequestMetadata = {
  version: 1
  model: string
  mode: 'structured' | 'native'
  purpose: ModelRequestPurpose
  temperature: number
  maxOutputTokens: number
  jsonMode: 'json_object' | 'none'
  stream: boolean
  thinking: EffectiveProviderThinking
  requestBytes: number
  messageCount: number
  toolCount: number
  policyVersion: 1
  startedAt: string
  requestConfigDigest?: string
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const oneOf = <T extends string>(v: unknown, values: readonly T[]): v is T => typeof v === 'string' && values.includes(v as T)
const timestamp = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(v) && Number.isFinite(Date.parse(v))
const digest = (v: unknown): v is string => typeof v === 'string' && /^sha256:[a-f0-9]{64}$/u.test(v)
export function safeProviderDiagnosticIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(value)) return undefined
  return redactSensitiveText(value).value === value ? value : undefined
}
function thinking(value: unknown): EffectiveProviderThinking | undefined {
  if (!record(value) || !oneOf(value.mode, ['enabled', 'disabled', 'provider_default']) || !oneOf(value.source, ['provider_configuration', 'application_default', 'provider_default'])) return undefined
  return { mode: value.mode, source: value.source, ...(value.mode === 'enabled' && oneOf(value.effort, ['low', 'high', 'max']) ? { effort: value.effort } : {}) }
}

/** Revalidate on persistence/export; casting an untrusted object to this type is insufficient. */
export function sanitizeAgentProviderRequestMetadata(value: unknown): AgentProviderRequestMetadata | undefined {
  if (!record(value) || value.version !== 1 || value.policyVersion !== 1) return undefined
  const model = safeProviderDiagnosticIdentifier(value.model)
  const safeThinking = thinking(value.thinking)
  if (!model || !safeThinking || !oneOf(value.mode, ['structured', 'native']) || !oneOf(value.purpose, ['conversation', 'proposal', 'review', 'workflow', 'native-tool']) || !oneOf(value.jsonMode, ['json_object', 'none']) || typeof value.stream !== 'boolean' || typeof value.temperature !== 'number' || !Number.isFinite(value.temperature) || value.temperature < 0 || value.temperature > 2 || !positive(value.maxOutputTokens) || !positive(value.requestBytes) || !positive(value.messageCount) || !positive(value.toolCount) || !timestamp(value.startedAt)) return undefined
  return { version: 1, model, mode: value.mode, purpose: value.purpose, temperature: value.temperature, maxOutputTokens: value.maxOutputTokens,
    jsonMode: value.jsonMode, stream: value.stream, thinking: safeThinking, requestBytes: value.requestBytes, messageCount: value.messageCount,
    toolCount: value.toolCount, policyVersion: 1, startedAt: value.startedAt, ...(digest(value.requestConfigDigest) ? { requestConfigDigest: value.requestConfigDigest } : {}) }
}

export function sanitizeAgentProviderResponseMetadata(value: unknown): AgentProviderResponseMetadata | undefined {
  if (!record(value) || !positive(value.httpStatus) || value.httpStatus < 100 || value.httpStatus > 599) return undefined
  const out: AgentProviderResponseMetadata = { httpStatus: value.httpStatus }
  for (const key of ['responseId', 'requestId', 'systemFingerprint'] as const) {
    const safe = safeProviderDiagnosticIdentifier(value[key]); if (safe) out[key] = safe
  }
  for (const key of ['durationMs', 'contentLength', 'reasoningLength', 'maxOutputTokens', 'contentBytes', 'reasoningBytes', 'wireBytes', 'limitThreshold', 'observedBytes', 'parserPosition', 'parserLine', 'parserColumn', 'sseFrameCount', 'sseDataFrameCount'] as const) {
    if (positive(value[key])) out[key] = value[key]
  }
  for (const key of ['startedAt', 'endedAt'] as const) if (timestamp(value[key])) out[key] = value[key]
  for (const key of ['streamed', 'streamDoneReceived', 'streamFinishReceived', 'streamCompleted'] as const) if (typeof value[key] === 'boolean') out[key] = value[key]
  if (oneOf(value.limitKind, ['content_bytes', 'reasoning_bytes', 'envelope_bytes', 'sse_frame_bytes'])) { out.limitKind = value.limitKind; out.limitUnit = 'bytes' }
  if (oneOf(value.parserCategory, ['sse_json', 'response_json', 'stream_shape', 'stream_incomplete', 'utf8', 'body_read', 'model_json', 'model_shape', 'model_content', 'model_finish', 'schema', 'semantic', 'http'])) out.parserCategory = value.parserCategory
  if (oneOf(value.parserErrorKind, ['syntax', 'unexpected_end', 'invalid_shape'])) out.parserErrorKind = value.parserErrorKind
  if (value.parserPositionUnit === 'utf16') out.parserPositionUnit = 'utf16'
  if (digest(value.contentDigest)) out.contentDigest = value.contentDigest
  if (value.contentDigestScope === 'received_content') out.contentDigestScope = 'received_content'
  if (oneOf(value.outputLimitMode, ['provider_default', 'explicit'])) out.outputLimitMode = value.outputLimitMode
  const effectiveThinking = thinking(value.effectiveThinking); if (effectiveThinking) out.effectiveThinking = effectiveThinking
  if (typeof value.finishReason === 'string') out.finishReason = oneOf(value.finishReason, ['stop', 'length', 'content_filter', 'insufficient_system_resource', 'tool_calls']) ? value.finishReason : 'unknown'
  return out
}

/** Only the numeric position is taken from SyntaxError, whose message may contain private text. */
export function safeJsonParseDiagnostics(error: unknown, source: string, offset = 0, parsedLength = source.length - offset): ResponseReadDiagnostics {
  const message = error instanceof Error ? error.message : ''
  const end = /Unexpected end of JSON input/iu.test(message)
  const match = /\bposition (\d+)\b/u.exec(message)
  const candidate = match ? Number(match[1]) + offset : end ? offset + parsedLength : undefined
  const position = candidate !== undefined && Number.isSafeInteger(candidate) && candidate >= 0 && candidate <= source.length ? candidate : undefined
  if (position === undefined) return { parserErrorKind: end ? 'unexpected_end' : 'syntax' }
  const before = source.slice(0, position)
  return { parserErrorKind: end ? 'unexpected_end' : 'syntax', parserPosition: position, parserPositionUnit: 'utf16', parserLine: before.split('\n').length, parserColumn: position - before.lastIndexOf('\n') }
}

/** A diagnostic failure must never replace the underlying operation's outcome. */
export async function providerDiagnosticDigest(text: string): Promise<string | undefined> {
  try {
    const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return `sha256:${Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')}`
  } catch { return undefined }
}
