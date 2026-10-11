import { MODEL_CONTENT_BYTES } from './provider-request-policy'
import type { NativeToolCall, NativeToolMessage } from './native-readonly-tools'

/** Transport envelope only. Argument validation belongs to the declared business/query tool. */
export function nativeCallEnvelope(value: unknown, allowed: string[], usedIds: string[] = []): NativeToolCall[] {
  if (!Array.isArray(value) || !value.length || value.length > 16) throw new Error('Invalid native call envelope')
  const ids = new Set(usedIds)
  let bytes = 0
  return value.map((raw: unknown) => {
    const call = raw as NativeToolCall
    if (!call || call.type !== 'function' || typeof call.id !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/u.test(call.id) || ids.has(call.id) ||
      !call.function || !allowed.includes(call.function.name) || typeof call.function.arguments !== 'string') throw new Error('Invalid native call identity')
    ids.add(call.id)
    bytes += new TextEncoder().encode(call.function.arguments).byteLength
    if (bytes > MODEL_CONTENT_BYTES) throw new Error('Native arguments exceed content capacity')
    return call
  })
}

/** Never dispatch a transcript with orphaned, duplicated or unfinished tool pairs. */
export function validateNativeHistory(messages: NativeToolMessage[], allowPending = false): void {
  if (!Array.isArray(messages) || !messages.length) throw new Error('Missing native history')
  const pending = new Set<string>(), used = new Set<string>()
  for (const message of messages) {
    if (!message || !['user', 'assistant', 'tool'].includes(message.role)) throw new Error('Invalid native message')
    if (message.role === 'tool') {
      if (!pending.delete(message.tool_call_id) || typeof message.content !== 'string') throw new Error('Unpaired native result')
    } else {
      if (pending.size) throw new Error('Incomplete native tool pair')
      if (message.role === 'user') {
        if (typeof message.content !== 'string') throw new Error('Invalid user content')
      } else {
        if (message.content !== null && typeof message.content !== 'string') throw new Error('Invalid assistant content')
        if (message.reasoning_content !== undefined && typeof message.reasoning_content !== 'string') throw new Error('Invalid native reasoning')
        if (message.tool_calls) for (const call of nativeCallEnvelope(message.tool_calls, message.tool_calls.map(c => c.function.name), [...used])) {
          used.add(call.id); pending.add(call.id)
        }
      }
    }
  }
  if (pending.size && !allowPending) throw new Error('Incomplete native tool pair')
}
