import { validateNativeHistory, type AgentProvider, type NativeConversationRequest, type NativeToolMessage } from '@ai-devflow/shared'
import { nativeRequestBudget } from './native-request-budget'
import { codingDigest } from './coding-candidate-workspace'
import type { NativeCodingSession } from './native-coding-session'

export type CodingCompaction = { through: number; sourceDigest: string; summary: string; attemptId: string; createdAt: string }
export type CodingContext = { request: NativeConversationRequest; compact?: { through: number; sourceDigest: string } }
export function codingContext(session: NativeCodingSession, provider: AgentProvider, input: NativeConversationRequest): CodingContext {
  const prior = session.compactions.at(-1), from = prior?.through ?? 1
  const humanCalls = new Set(session.transcript.flatMap(message => message.role === 'assistant' ? (message.tool_calls ?? []).filter(call => call.function.name === 'request_user_input').map(call => call.id) : []))
  const constraints = session.transcript.slice(1, prior?.through ?? 1).flatMap((message, index) => message.role === 'user' || (message.role === 'tool' && humanCalls.has(message.tool_call_id)) ? [{ index: index + 1, text: message.content }] : [])
  const pinned: NativeToolMessage[] = [session.transcript[0]!, ...(prior ? [
    { role: 'user' as const, content: `早期历史摘要（仅供导航，原始记录可用 read_history 按消息序号读取）：\n${prior.summary}\n来源消息 [0, ${prior.through})，摘要 ${prior.sourceDigest}` },
    // Human constraints cannot depend on a model-written summary retaining them.
    { role: 'user' as const, content: `必须保留的用户原话与澄清答案（后续明确更正优先）：\n${JSON.stringify(constraints)}` },
  ] : [])]
  const request = { ...input, messages: prior ? [...pinned, ...session.transcript.slice(prior.through)] : session.transcript }
  const budget = nativeRequestBudget(provider, request)
  if (!budget.overflow && budget.bytes < budget.limits.bytes * .8 && budget.tokens < budget.limits.tokens * .8) return { request }
  validateNativeHistory(session.transcript)
  let candidate: CodingContext | undefined
  for (let through = from + 1; through <= session.transcript.length; through++) {
    const part = session.transcript.slice(from, through)
    try { validateNativeHistory(part); if (through < session.transcript.length) validateNativeHistory(session.transcript.slice(through)) } catch { continue }
    const compactRequest: NativeConversationRequest = { ...input,
      systemPrompt: '压缩既有编码任务历史，不调用业务工具、不执行操作。保持目标、用户限制、已读文件及摘要、改动与测试失败事实、未解决事项。保留消息序号便于回读。未知内容明确写未知。只用 compact_context 返回摘要。',
      messages: [{ role: 'user', content: JSON.stringify({ objective: session.objective, objectiveVersion: session.objectiveVersion, previousSummary: prior?.summary, sourceRange: [from, through], history: part.map((message, index) => ({ index: from + index, message })) }) }],
      tools: [{ type: 'function', function: { name: 'compact_context', description: '保存可追溯的早期历史摘要。', parameters: { type: 'object', additionalProperties: false, required: ['summary'], properties: { summary: { type: 'string', maxLength: 16000 } } } } }],
      maxOutputTokens: Math.min(input.maxOutputTokens ?? 4096, 4096),
    }
    const measured = nativeRequestBudget(provider, compactRequest)
    if (measured.overflow) break
    candidate = { request: compactRequest, compact: { through, sourceDigest: codingDigest(JSON.stringify(session.transcript.slice(0, through))) } }
    // Keep recent closed turns whenever the remainder will fit. Otherwise compact the next bounded chunk.
    const remaining = { ...request, messages: [...pinned, { role: 'user' as const, content: '摘要空间'.repeat(3000) }, ...session.transcript.slice(through)] }
    if (!nativeRequestBudget(provider, remaining).overflow && through >= session.transcript.length - 12) break
  }
  if (!candidate) throw new Error('Complete required coding context exceeds provider capacity; no model call was sent')
  return candidate
}
