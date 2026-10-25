import desktopPackage from '../package.json'
import { redactSensitiveText, sanitizeAgentProviderRequestMetadata, sanitizeAgentProviderResponseMetadata } from '@ai-devflow/shared'
import type { ConversationMessage, WorkbenchConversation } from './workbench-conversation-contract'

/** Only the unsaved diagnostic fields, never another copy of conversation/provider bodies. */
export class ConversationPersistenceError extends Error {
  override name = 'ConversationPersistenceError'
  pendingDiagnostic?: Pick<ConversationMessage, 'id' | 'failure' | 'usage' | 'requestMetadata' | 'responseMetadata'>
}

const MAX_CALLS = 200, MAX_AGE = 30 * 86400000, MAX_EXPORT_BYTES = 512 * 1024
const atom = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,240}$/u.test(value) && redactSensitiveText(value).value === value ? value : undefined
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const enumeration = (value: unknown, allowed: readonly string[]) => typeof value === 'string' && allowed.includes(value) ? value : 'unknown'
const phases = ['resolve_provider','resolve_harness','select_protocol','read_context','provider_request','validate_response','native_conversation','native_context','native_response','native_proposal_review','investigation_summary']
const codes = ['ConversationPersistenceError', 'provider_timeout', 'dns_failure', 'tls_failure', 'connection_failed', 'connection_reset', 'proxy_failure', 'http_429', 'http_4xx', 'http_5xx', 'invalid_response_json', 'invalid_model_output', 'invalid_usage', 'response_too_large', 'cancelled_by_user', 'unknown_provider_failure', 'native_conversation_failed', 'harness_response_failed', 'unknown']
const reasons = ['native_tool_scope_denied', 'input_capacity_exceeded', 'invalid_structured_request', 'invalid_json', 'not_json_object', 'empty_content', 'missing_content', 'invalid_reasoning', 'output_length', 'content_filter', 'incomplete_response', 'invalid_conversation_schema', 'invalid_proposal_semantics', 'invalid_native_arguments', 'invalid_native_target', 'invalid_native_call_identity', 'invalid_proposal_review', 'native_history_corrupt', 'native_queries_failed', 'proposal_sources_not_ready', 'missing_native_turn', 'request_deadline_exceeded', 'caller_abort_signal', 'proxy_authentication_required', 'provider_rate_limited', 'provider_rejected_request', 'provider_server_failure', 'reset_before_tls_handshake', 'unclassified_transport_failure', 'budget_exceeded', 'permission_denied']
const boundaries = ['step_limit', 'time_limit', 'tool_limit', 'no_progress', 'request_limit', 'recovery_limit', 'summary_limit']
const deliveryStates = ['prepared', 'dispatch_started', 'response_received', 'not_sent', 'delivery_unknown']
const sessionStatuses = ['idle', 'running', 'awaiting_answer', 'failed', 'cancelled', 'interrupted', 'paused']
export function safeConversationFailure(value?: unknown) {
  if (!value) return undefined
  const failure = object(value)
  return { ...sanitizeAgentProviderResponseMetadata(value), phase: enumeration(failure.phase, phases),
    code: enumeration(failure.code, codes), ...(failure.reason !== undefined ? { reason: enumeration(failure.reason, reasons) } : {}),
    ...(failure.diagnosticPersistenceFailed === true ? { diagnosticPersistenceFailed: true } : {}) }
}
function progressDiagnostic(value: unknown) {
  const progress = object(value)
  if (progress.version !== 1) return null
  const policy = object(progress.policy), batch = object(progress.batch), totals = object(progress.totals)
  const numeric = (source: Record<string, unknown>, fields: string[]) => Object.fromEntries(fields.map(key => [key, count(source[key]) ?? null]))
  return { version: 1, stopReason: progress.stopReason === undefined ? null : enumeration(progress.stopReason, boundaries),
    policy: { source: enumeration(policy.source, ['default', 'conversation']), ...numeric(policy, ['maxSteps', 'maxDurationMs', 'maxToolCalls', 'maxRequests', 'maxRecoveries', 'maxTotalToolCalls', 'noProgressLimit', 'summaryRequests', 'summaryDurationMs']) },
    totals: numeric(totals, ['requests', 'recoveries', 'toolCalls', 'summaryRequests']),
    batch: { id: atom(batch.id) ?? 'unknown', ...numeric(batch, ['startedAt', 'steps', 'requests', 'recoveries', 'toolCalls', 'summaryRequests', 'noProgress', 'repeatedQueries', 'reusedQueries']) },
  }
}
function callDiagnostic(message: ConversationMessage) {
  const usage = message.usage ? Object.fromEntries(['inputTokens','outputTokens','totalTokens','cacheReadTokens','cacheMissTokens'].flatMap(key => {
    const value=count(message.usage![key as keyof typeof message.usage]);return value===undefined?[]:[[key,value]]
  })) : null
  const attempt=message.attempt
  return { id:atom(message.id)??'unknown',createdAt:date(message.createdAt)??null,
    provider: message.provider ? {model:atom(message.provider.model)??'unknown',executor:['direct-provider','opencode','native-tools'].includes(message.provider.executor??'')?message.provider.executor:'unknown'}:null,
    attempt: attempt ? {turnId:atom(attempt.turnId)??null,step:count(attempt.step)??null,cycle:count(attempt.cycle)??null,recovery:count(attempt.recovery)??null,group:atom(attempt.group)??null,
      batchId:atom(attempt.batchId)??null,maxSteps:count(attempt.maxSteps)??null,maxDurationMs:count(attempt.maxDurationMs)??null,policySource:enumeration(attempt.policySource,['default','conversation']),
      startedAt:date(attempt.startedAt)??null,durationMs:count(attempt.durationMs)??null,status:['running','completed','failed'].includes(attempt.status)?attempt.status:'unknown'}:null,
    request:sanitizeAgentProviderRequestMetadata(message.requestMetadata)??null,
    response:sanitizeAgentProviderResponseMetadata(message.responseMetadata)??null,
    failure:safeConversationFailure(message.failure)??null,usage,
    delivery:message.memoryReceipt?.state === undefined ? null : enumeration(message.memoryReceipt.state, deliveryStates),
  }
}
/** Rotate only additional diagnostic detail. Original messages, evidence and billing records stay intact. */
export function retainConversationDiagnostics(session: WorkbenchConversation, nowMs=Date.now()): WorkbenchConversation {
  const retained=new Set(session.messages.filter(m=>m.provider && Date.parse(m.createdAt)>=nowMs-MAX_AGE).slice(-MAX_CALLS).map(m=>m.id))
  return {...session,messages:session.messages.map(m=>{
    if(retained.has(m.id)) return m
    if(!m.requestMetadata && !m.responseMetadata && !m.failure && !m.attempt)return m
    const {requestMetadata:_request,responseMetadata:_response,failure:_failure,attempt:_attempt,...rest}=m
    return rest
  })}
}
/** Explicit projection: no message, source, tool argument, prompt, draft or reasoning text is exported. */
export function buildConversationDiagnostics(session:WorkbenchConversation,nowMs=Date.now()) {
  const all=session.messages.filter(m=>m.provider)
  const calls=all.filter(m=>Date.parse(m.createdAt)>=nowMs-MAX_AGE).slice(-MAX_CALLS).map(callDiagnostic)
  const report={version:1,generatedAt:new Date(nowMs).toISOString(),conversationId:atom(session.id)??'unknown',status:enumeration(session.status, sessionStatuses),
    application:{name:'DevFlow Studio',version:desktopPackage.version,protocol:session.nativeProtocolVersion===2?'native-v2':session.executor==='opencode'?'opencode-harness':'structured-v1'},
    retention:{maxCalls:MAX_CALLS,maxAgeDays:30,maxBytes:MAX_EXPORT_BYTES},
    replay:{available:false,reason:'仅保留结构与摘要；没有原始响应正文，不能重放历史失败。'},
    investigation:progressDiagnostic(session.investigationProgress),calls,omittedCalls:all.length-calls.length}
  while(new TextEncoder().encode(JSON.stringify(report)).byteLength>MAX_EXPORT_BYTES && calls.length){calls.shift();report.omittedCalls++}
  return report
}
export type ConversationDiagnostics = ReturnType<typeof buildConversationDiagnostics>
