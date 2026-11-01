import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import {
  AgentProviderRequestError, classifyProviderTransportError, governedModelCall, modelCallMetadata,
  parseOpenAiCompatibleProviderUsage, ProviderResponseReadError, providerThinkingRequestFields, readProviderResponse,
  resolveProviderThinking, resolveRequestPolicy, supportsProviderThinking, type AgentProviderUsage, type ModelCallGovernance,
} from '@ai-devflow/shared'
import type { OpencodeProviderBinding } from './opencode-provider-binding'

export const MEMORY_RELAY_DEFAULT_PORT = 8891
/** Extraction and consolidation answers are short structured JSON; this bounds each reservation. */
export const MEMORY_RELAY_MAX_OUTPUT_TOKENS = 8192
const MAX_REQUEST_BYTES = 4 * 1024 * 1024

export type MemoryRelayRoute = { projectId: string; binding: OpencodeProviderBinding }
export type MemoryRelayCall = {
  at: string; bankId: string; projectId?: string
  status: 'succeeded' | 'refused' | 'failed'; usage?: AgentProviderUsage; reason?: string
}
export type MemoryModelRelay = Awaited<ReturnType<typeof createMemoryModelRelay>>

function sameToken(header: string | undefined, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`)
  const actual = Buffer.from(header ?? '')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0; const chunks: Buffer[] = []
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk); size += bytes.length
    if (size > MAX_REQUEST_BYTES) throw new Error('request_too_large')
    chunks.push(bytes)
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
}
function reply(res: ServerResponse, status: number, message: string) {
  if (!res.headersSent && !res.destroyed) res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message } }))
}

/**
 * Hindsight's extraction and consolidation calls reach the model through this loopback relay
 * (ADR 0030). Hindsight sends its bank id as the OpenAI `user` field; the relay maps it to a
 * project, charges the project's model budget, and calls the saved Provider with its own key.
 * Hindsight never holds a Provider credential.
 */
export async function createMemoryModelRelay(input: {
  port: number; host?: string; token: string
  resolveBank(bankId: string): Promise<MemoryRelayRoute | null>
  governance(projectId: string): Promise<ModelCallGovernance>
  fetcher?: typeof fetch
  onCall?(call: MemoryRelayCall): void
}) {
  if (!/^[A-Za-z0-9_-]{32,200}$/u.test(input.token)) throw new Error('Memory relay token is invalid')
  const controllers = new Set<AbortController>()
  const server = createServer(async (req, res) => {
    const controller = new AbortController(); controllers.add(controller)
    const abort = () => { if (!res.writableEnded) controller.abort() }
    res.on('close', abort)
    const record = (call: Omit<MemoryRelayCall, 'at'>) => input.onCall?.({ at: new Date().toISOString(), ...call })
    let bankId = ''
    let routedProjectId: string | undefined
    try {
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { reply(res, 404, 'not_found'); return }
      if (!sameToken(req.headers.authorization, input.token)) { reply(res, 401, 'DevFlow memory relay token is not valid'); return }
      let raw: string
      let body: Record<string, unknown>
      try {
        raw = await readBody(req)
        const parsed: unknown = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_request')
        body = parsed as Record<string, unknown>
      } catch { reply(res, 400, 'Invalid request body'); return }
      bankId = typeof body.user === 'string' ? body.user : ''
      const route = bankId ? await input.resolveBank(bankId) : null
      if (!route) {
        record({ bankId, status: 'refused', reason: 'memory_not_enabled' })
        reply(res, 403, 'DevFlow memory is not enabled for this bank; no model call was made.'); return
      }
      const { binding, projectId } = route
      routedProjectId = projectId
      const known = supportsProviderThinking({ baseUrl: binding.baseUrl, model: binding.modelId })
      // Extraction does not need reasoning; disabling it keeps each call cheap and short.
      const effectiveThinking = resolveProviderThinking({ baseUrl: binding.baseUrl, model: binding.modelId, ...(known ? { thinking: { mode: 'disabled' as const } } : {}) })
      const requested = body.max_tokens ?? body.max_completion_tokens
      const explicit = typeof requested === 'number' && Number.isSafeInteger(requested) && requested > 0 ? requested : undefined
      const policy = resolveRequestPolicy({ model: binding.modelId, baseUrl: binding.baseUrl, effectiveThinking,
        maxOutputTokens: Math.min(explicit ?? MEMORY_RELAY_MAX_OUTPUT_TOKENS, MEMORY_RELAY_MAX_OUTPUT_TOKENS) })
      const wantsStream = body.stream === true
      const { user: _user, max_completion_tokens: _limit, stream: _stream, stream_options: _options, model: _model, ...rest } = body
      const upstreamBody = { ...rest, model: binding.modelId, max_tokens: policy.maxOutputTokens, ...providerThinkingRequestFields(effectiveThinking),
        stream: policy.stream, ...(policy.stream ? { stream_options: { include_usage: true } } : {}) }
      let governance: ModelCallGovernance
      try { governance = await input.governance(projectId) } catch {
        // No paired Team budget (or it cannot be read): refuse before any model call.
        record({ bankId, projectId, status: 'refused', reason: 'budget_unavailable' })
        reply(res, 403, 'DevFlow could not open this project\'s model budget; no model call was made.'); return
      }
      const result = await governedModelCall({ governance, projectId, provider: modelCallMetadata(binding), prompt: raw,
        signal: controller.signal, maxOutputTokens: policy.maxOutputTokens,
        ...(policy.capability === 'deepseek-2026-10-10' ? { boundBasis: 'deepseek-context-v1' as const } : {}),
        action: async (observe) => {
          let upstream: Response
          try {
            upstream = await (input.fetcher ?? fetch)(`${binding.baseUrl.replace(/\/$/u, '')}/chat/completions`, {
              method: 'POST', headers: { authorization: `Bearer ${binding.apiKey}`, 'content-type': 'application/json' },
              redirect: 'error', signal: controller.signal, body: JSON.stringify(upstreamBody) })
          } catch (error) {
            if (controller.signal.aborted) throw error
            throw classifyProviderTransportError(error)
          }
          if (!upstream.ok) {
            void upstream.body?.cancel().catch(() => undefined)
            throw new AgentProviderRequestError({ code: upstream.status === 429 ? 'http_429' : upstream.status >= 500 ? 'http_5xx' : 'http_4xx',
              httpStatus: upstream.status, deliveryState: 'response_received', billingState: 'unknown', retryable: false, sanitizedCause: 'memory_provider_http' })
          }
          let usage: AgentProviderUsage | undefined
          try {
            const value = (await readProviderResponse({ response: upstream, signal: controller.signal, policy,
              onUsage: async (rawUsage, final) => {
                try { usage = parseOpenAiCompatibleProviderUsage(rawUsage, { providerId: binding.providerId, model: binding.modelId, baseUrl: binding.baseUrl }) }
                catch { throw new AgentProviderRequestError({ code: 'invalid_usage', deliveryState: 'response_received', billingState: 'unknown', retryable: false, sanitizedCause: 'memory_invalid_usage' }) }
                if (usage) { usage = { ...usage, usageCompleteness: final ? 'final' : 'partial' }; await observe(usage) }
              } })).body
            return { value, ...(usage ? { usage } : {}) }
          } catch (error) {
            if (error instanceof ProviderResponseReadError) throw new AgentProviderRequestError({
              code: error.code === 'response_too_large' ? 'response_too_large' : 'invalid_response_json', httpStatus: upstream.status,
              deliveryState: 'response_received', billingState: usage?.usageCompleteness === 'final' ? 'confirmed' : 'unknown', retryable: false,
              sanitizedCause: `memory_${error.code}`, ...(usage ? { usage } : {}) })
            throw error
          }
        } })
      record({ bankId, projectId, status: 'succeeded', ...(result.usage ? { usage: result.usage } : {}) })
      if (res.destroyed) return
      if (wantsStream) {
        const choices = Array.isArray(result.value.choices) ? result.value.choices as Array<Record<string, unknown>> : []
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        for (const choice of choices) res.write(`data: ${JSON.stringify({ ...result.value, object: 'chat.completion.chunk', usage: undefined,
          choices: [{ index: choice.index ?? 0, delta: choice.message, finish_reason: null }] })}\n\n`)
        res.end(`data: ${JSON.stringify({ ...result.value, object: 'chat.completion.chunk',
          choices: choices.map((choice) => ({ index: choice.index ?? 0, delta: {}, finish_reason: choice.finish_reason })) })}\n\ndata: [DONE]\n\n`)
      } else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result.value))
    } catch (error) {
      const failure = error instanceof AgentProviderRequestError ? error : undefined
      const refused = failure?.sanitizedCause === 'budget_not_ready'
      record({ bankId, ...(routedProjectId ? { projectId: routedProjectId } : {}), status: refused ? 'refused' : 'failed',
        reason: failure?.sanitizedCause ?? 'relay_failed',
        ...(failure?.usage ? { usage: failure.usage } : {}) })
      // Hindsight records the call as failed; the document is retried later within its attempt limit.
      reply(res, refused ? 429 : failure?.httpStatus ? 502 : 500, refused ? failure!.message : 'DevFlow memory relay could not complete the model call.')
    } finally { controllers.delete(controller); res.off('close', abort) }
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(input.port, input.host ?? '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Memory relay unavailable')
  return {
    port: address.port,
    async close() {
      for (const controller of controllers) controller.abort()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
