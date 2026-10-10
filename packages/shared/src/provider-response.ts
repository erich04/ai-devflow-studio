import type { ResolvedRequestPolicy } from './provider-request-policy'

export type ResponseReadDiagnostics = {
  limitKind?: 'content_bytes' | 'reasoning_bytes' | 'envelope_bytes' | 'sse_frame_bytes'
  limitUnit?: 'bytes'; limitThreshold?: number; observedBytes?: number
  parserCategory?: 'sse_json' | 'response_json' | 'stream_shape' | 'stream_incomplete' | 'utf8' | 'body_read'
  parserPosition?: number
  contentBytes?: number; reasoningBytes?: number; wireBytes?: number; responseId?: string
}
export class ProviderResponseReadError extends Error {
  constructor(readonly code: 'response_too_large' | 'body_read_failed', readonly diagnostics: ResponseReadDiagnostics) { super(code) }
}
export type ProviderContentSink = { append(channel: 'content' | 'reasoning', text: string): void | Promise<void> }
const encoder = new TextEncoder()
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
function parse(raw: string, category: 'sse_json' | 'response_json'): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw)
    if (object(value)) return value
  } catch (error) {
    // Never retain SyntaxError.message: modern engines include input text in it.
    const position = error instanceof Error ? /position (\d+)/u.exec(error.message)?.[1] : undefined
    throw new ProviderResponseReadError('body_read_failed', { parserCategory: category, ...(position ? { parserPosition: Number(position) } : {}) })
  }
  throw new ProviderResponseReadError('body_read_failed', { parserCategory: category })
}

/** Incremental SSE: consumed frames are discarded; only decoded channels are retained. */
export async function readProviderResponse(input: {
  response: Response; signal: AbortSignal; policy: ResolvedRequestPolicy
  onUsage(value: unknown, final: boolean): void | Promise<void>
  onProgress?(): void
  onDiagnostics?(diagnostics: ResponseReadDiagnostics): void
  sink?: ProviderContentSink | undefined
}): Promise<{ body: Record<string, unknown>; diagnostics: ResponseReadDiagnostics }> {
  const { response, signal, policy } = input
  const streamed = response.headers.get('content-type')?.includes('text/event-stream') === true
  const diagnostics: ResponseReadDiagnostics = { contentBytes: 0, reasoningBytes: 0, wireBytes: 0 }
  const check = (kind: NonNullable<ResponseReadDiagnostics['limitKind']>, size: number, limit: number) => {
    if (size > limit) throw new ProviderResponseReadError('response_too_large', { ...diagnostics, limitKind: kind, limitUnit: 'bytes', limitThreshold: limit, observedBytes: size })
  }
  const declared = response.headers.get('content-length')
  if (!response.body) throw new ProviderResponseReadError('body_read_failed', { parserCategory: 'body_read' })
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const decode = (bytes?: Uint8Array, stream = false) => {
    try { return decoder.decode(bytes, { stream }) }
    catch { throw new ProviderResponseReadError('body_read_failed', { ...diagnostics, parserCategory: 'utf8' }) }
  }
  let toolBytes = 0
  const content: string[] = []; const reasoning: string[] = []; const raw: string[] = []
  let pending = ''; let done = false; let finished = false; let finishReason: unknown
  let usage: unknown; let id: unknown; let fingerprint: unknown
  const toolCalls = new Map<number, { id: string; type: string; function: { name: string; arguments: string } }>()
  const malformed = () => new ProviderResponseReadError('body_read_failed', { ...diagnostics, parserCategory: 'stream_shape' })
  const append = async (channel: 'content' | 'reasoning', text: unknown) => {
    if (text == null) return
    if (typeof text !== 'string') throw malformed()
    const key = channel === 'content' ? 'contentBytes' : 'reasoningBytes'
    diagnostics[key] = (diagnostics[key] ?? 0) + encoder.encode(text).byteLength
    check(channel === 'content' ? 'content_bytes' : 'reasoning_bytes', diagnostics[key]!, channel === 'content' ? policy.contentBytes : policy.reasoningBytes)
    input.onDiagnostics?.({ ...diagnostics })
    ;(channel === 'content' ? content : reasoning).push(text)
    await input.sink?.append(channel, text)
  }
  const consume = async (frame: string) => {
    const data = frame.split(/\r?\n/u).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /u, '')).join('\n')
    if (!data) return
    if (data === '[DONE]') { done = true; return }
    const chunk = parse(data, 'sse_json')
    if (typeof chunk.id === 'string' && /^[A-Za-z0-9_-]{1,160}$/u.test(chunk.id)) diagnostics.responseId = chunk.id
    input.onDiagnostics?.({ ...diagnostics })
    // Save usage before validating a later field or attempting to parse the model's JSON.
    if (chunk.usage != null) { usage = chunk.usage; await input.onUsage(usage, finished || (Array.isArray(chunk.choices) && chunk.choices.some(choice => object(choice) && choice.finish_reason != null))) }
    if (chunk.id !== undefined) id = chunk.id
    if (chunk.system_fingerprint !== undefined) fingerprint = chunk.system_fingerprint
    if (chunk.error || !Array.isArray(chunk.choices) || chunk.choices.length > 1) throw malformed()
    if (!chunk.choices.length) return
    const choice: unknown = chunk.choices[0]
    if (!object(choice) || (choice.index !== undefined && choice.index !== 0) || !object(choice.delta)) throw malformed()
    const delta = choice.delta
    if (finished && (delta.content || delta.reasoning_content || delta.tool_calls)) throw malformed()
    await append('content', delta.content); await append('reasoning', delta.reasoning_content)
    if (delta.tool_calls != null) {
      if (!Array.isArray(delta.tool_calls) || delta.tool_calls.length > 16) throw malformed()
      for (const part of delta.tool_calls) {
        if (!object(part) || !Number.isSafeInteger(part.index) || Number(part.index) < 0 || Number(part.index) >= 16 || !object(part.function)) throw malformed()
        const index = Number(part.index)
        const call = toolCalls.get(index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } }
        if (part.id !== undefined) {
          if (typeof part.id !== 'string' || (call.id && call.id !== part.id)) throw malformed()
          call.id = part.id
        }
        if (part.type !== undefined && part.type !== 'function') throw malformed()
        for (const key of ['name', 'arguments'] as const) if (part.function[key] != null) {
          if (typeof part.function[key] !== 'string') throw malformed()
          toolBytes += encoder.encode(part.function[key]).byteLength
          check('content_bytes', (diagnostics.contentBytes ?? 0) + toolBytes, policy.contentBytes)
          call.function[key] += part.function[key]
        }
        check('content_bytes', encoder.encode(call.function.arguments).byteLength, policy.contentBytes)
        toolCalls.set(index, call)
      }
    }
    if (choice.finish_reason != null) { if (!finished) finishReason = choice.finish_reason; finished = true }
  }
  const abort = () => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener('abort', abort, { once: true })
  try {
    if (!streamed && declared && /^\d+$/u.test(declared)) check('envelope_bytes', Number(declared), policy.envelopeBytes)
    while (!done) {
      signal.throwIfAborted()
      let next: ReadableStreamReadResult<Uint8Array>
      try { next = await reader.read() }
      catch { throw new ProviderResponseReadError('body_read_failed', { ...diagnostics, parserCategory: 'body_read' }) }
      signal.throwIfAborted()
      if (next.done) {
        const tail = decode()
        if (streamed) pending += tail; else raw.push(tail)
        break
      }
      input.onProgress?.()
      diagnostics.wireBytes! += next.value.byteLength
      input.onDiagnostics?.({ ...diagnostics })
      const text = decode(next.value, true)
      if (!streamed) { check('envelope_bytes', diagnostics.wireBytes!, policy.envelopeBytes); raw.push(text); continue }
      pending += text
      let boundary: RegExpExecArray | null
      while (!done && (boundary = /\r?\n\r?\n/u.exec(pending))) {
        const frame = pending.slice(0, boundary.index)
        pending = pending.slice(boundary.index + boundary[0].length)
        check('sse_frame_bytes', encoder.encode(frame).byteLength, policy.envelopeBytes)
        await consume(frame)
      }
      check('sse_frame_bytes', encoder.encode(pending).byteLength, policy.envelopeBytes)
    }
    if (streamed) {
      if (!done && pending.trim()) await consume(pending)
      if (!done || !finished) throw new ProviderResponseReadError('body_read_failed', { ...diagnostics, parserCategory: 'stream_incomplete' })
      return { body: { id, system_fingerprint: fingerprint, usage, choices: [{ message: { content: content.join(''), reasoning_content: reasoning.join(''), ...(toolCalls.size ? { tool_calls: [...toolCalls].sort(([a], [b]) => a - b).map(([,v]) => v) } : {}) }, finish_reason: finishReason }] }, diagnostics }
    }
    const body = parse(raw.join(''), 'response_json')
    if (body.usage != null) await input.onUsage(body.usage, true)
    const message = Array.isArray(body.choices) ? body.choices[0]?.message : undefined
    if (object(message)) { await append('content', message.content); await append('reasoning', message.reasoning_content) }
    return { body, diagnostics }
  } catch (error) {
    if (error instanceof ProviderResponseReadError) { input.onDiagnostics?.({ ...diagnostics, ...error.diagnostics }); throw error }
    if (signal.aborted) throw error
    // Callback exceptions are not UTF-8 or network failures.
    throw error
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
